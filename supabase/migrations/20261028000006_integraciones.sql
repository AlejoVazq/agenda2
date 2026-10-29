-- =============================================================================
-- Fases 5 y 6: Google Calendar, seña con Mercado Pago, avisos por WhatsApp y
-- límites de uso del portal público.
--
-- Los secretos (tokens de Google y de Mercado Pago) van en una tabla aparte,
-- cifrados por la aplicación, a la que solo accede el servidor (service role).
-- =============================================================================

-- Negocio: seña y avisos por WhatsApp --------------------------------------------
alter table public.negocios
  add column sena_tipo      text not null default 'ninguna' check (sena_tipo in ('ninguna', 'porcentaje', 'fijo')),
  add column sena_valor     numeric(12, 2) not null default 0 check (sena_valor >= 0 and sena_valor <= 99999999),
  add column pago_plazo_min integer not null default 30 check (pago_plazo_min between 10 and 1440),
  add column whatsapp_avisos boolean not null default false,
  add constraint negocios_sena_porcentaje_check check (sena_tipo <> 'porcentaje' or sena_valor <= 100);

grant update (sena_tipo, sena_valor, pago_plazo_min, whatsapp_avisos) on public.negocios to authenticated;

-- Turnos: estado del pago, sincronización con Google y aviso por WhatsApp ------
alter table public.turnos
  add column sena_monto                 numeric(12, 2) check (sena_monto > 0),
  add column pago_vence_at              timestamptz,
  add column google_calendar_prof_id    uuid,
  add column google_sincronizado_at     timestamptz,
  add column recordatorio_wa_enviado_at timestamptz,
  -- pendiente: esperando la seña (el horario queda retenido hasta pago_vence_at)
  -- aprobado:  seña cobrada (online o marcada a mano)
  -- vencido:   no se pagó a tiempo y el turno se liberó
  -- reembolsar: se cobró pero el turno ya no existe (devolver la seña)
  -- devuelta: el negocio registró que devolvió la seña
  add constraint turnos_pago_estado_check
    check (pago_estado is null or pago_estado in ('pendiente', 'aprobado', 'vencido', 'reembolsar', 'devuelta')),
  add constraint turnos_pago_pendiente_check
    check (pago_estado is distinct from 'pendiente' or pago_vence_at is not null);

alter table public.turnos drop constraint turnos_cancelado_por_check;
alter table public.turnos
  add constraint turnos_cancelado_por_check check (cancelado_por in ('cliente', 'negocio', 'sistema'));

create index turnos_pago_pendiente_idx on public.turnos (pago_vence_at) where pago_estado = 'pendiente';

-- El panel puede marcar una seña como cobrada (efectivo, transferencia).
grant update (pago_estado) on public.turnos to authenticated;

-- Bloqueos importados desde Google Calendar ------------------------------------
alter table public.bloqueos
  add column origen text not null default 'manual' check (origen in ('manual', 'google'));

create index bloqueos_google_idx on public.bloqueos (profesional_id, inicio) where origen = 'google';

-- Integraciones -----------------------------------------------------------------
-- Una fila por negocio y proveedor (Mercado Pago, WhatsApp) o por profesional
-- (Google Calendar). `config` guarda solo datos no secretos (cuenta, opciones).
alter table public.integraciones
  add constraint integraciones_unica unique nulls not distinct (negocio_id, proveedor, profesional_id);

create policy integraciones_select_propia on public.integraciones
  for select to authenticated
  using (public.es_miembro(negocio_id) and profesional_id is not null and profesional_id = public.mi_profesional_id());

-- Altas, bajas y cambios solo desde el servidor, después de verificar permisos.
revoke insert, update, delete on public.integraciones from authenticated;

create table public.integraciones_secretos (
  integracion_id uuid primary key references public.integraciones (id) on delete cascade,
  -- Texto cifrado por la aplicación (AES-256-GCM con INTEGRACIONES_CLAVE).
  datos          text not null,
  updated_at     timestamptz not null default now()
);

alter table public.integraciones_secretos enable row level security;
revoke all on public.integraciones_secretos from anon, authenticated;

create trigger integraciones_secretos_updated_at before update on public.integraciones_secretos
  for each row execute function public.tg_set_updated_at();

-- Límites de uso (anti-abuso del portal público) --------------------------------
create table public.limites_uso (
  clave   text not null,
  ventana timestamptz not null,
  cuenta  integer not null default 0,
  primary key (clave, ventana)
);

alter table public.limites_uso enable row level security;
revoke all on public.limites_uso from anon, authenticated;

-- Suma un uso a `clave` en la ventana actual y dice si sigue dentro del límite.
create or replace function public.consumir_limite(p_clave text, p_maximo integer, p_ventana_seg integer)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ventana timestamptz := to_timestamp(floor(extract(epoch from now()) / p_ventana_seg) * p_ventana_seg);
  v_cuenta  integer;
begin
  insert into public.limites_uso as l (clave, ventana, cuenta)
  values (p_clave, v_ventana, 1)
  on conflict (clave, ventana) do update set cuenta = l.cuenta + 1
  returning cuenta into v_cuenta;
  return v_cuenta <= p_maximo;
end;
$$;

-- Señas: vencimiento, cálculo y registro de pagos --------------------------------

-- Libera los turnos cuya seña no se pagó a tiempo. Devuelve cuántos liberó.
create or replace function public.vencer_pagos_pendientes(p_negocio_id uuid default null)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cantidad integer;
begin
  update public.turnos
  set estado = 'cancelado', cancelado_at = now(), cancelado_por = 'sistema', pago_estado = 'vencido'
  where pago_estado = 'pendiente'
    and pago_vence_at < now()
    and estado in ('pendiente', 'confirmado')
    and (p_negocio_id is null or negocio_id = p_negocio_id);
  get diagnostics v_cantidad = row_count;
  return v_cantidad;
end;
$$;

-- Monto de seña que corresponde a un servicio (0 = no se pide seña). Solo se pide
-- si el negocio la configuró y tiene Mercado Pago conectado.
create or replace function public.monto_sena(p_negocio public.negocios, p_precio numeric)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not exists (
      select 1 from public.integraciones i
      where i.negocio_id = p_negocio.id and i.proveedor = 'mercadopago' and i.estado = 'activa'
    ) then 0
    when p_negocio.sena_tipo = 'porcentaje' and coalesce(p_precio, 0) > 0
      then round(p_precio * p_negocio.sena_valor / 100, 0)
    when p_negocio.sena_tipo = 'fijo'
      then case when coalesce(p_precio, 0) > 0 then least(p_negocio.sena_valor, p_precio) else p_negocio.sena_valor end
    else 0
  end;
$$;

-- Registra el resultado de un pago verificado contra Mercado Pago (solo servidor).
-- Devuelve: 'confirmado' | 'pendiente' (seña cobrada, falta que el negocio confirme)
-- | 'ya_procesado' | 'rechazado' | 'reembolsar' (cobrado pero sin turno).
create or replace function public.registrar_pago(
  p_turno_id uuid,
  p_pago_id  text,
  p_aprobado boolean,
  p_monto    numeric
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_turno  public.turnos;
  v_estado public.estado_turno;
begin
  select * into v_turno from public.turnos where id = p_turno_id for update;
  if not found then
    return 'rechazado';
  end if;

  if v_turno.pago_estado in ('aprobado', 'reembolsar', 'devuelta') then
    return 'ya_procesado';
  end if;
  if not p_aprobado then
    return 'rechazado';
  end if;

  select case when n.confirmacion_automatica then 'confirmado' else 'pendiente' end::public.estado_turno
  into v_estado
  from public.negocios n where n.id = v_turno.negocio_id;

  if coalesce(p_monto, 0) + 0.01 < coalesce(v_turno.sena_monto, 0) then
    update public.turnos set pago_estado = 'reembolsar', pago_id = p_pago_id where id = p_turno_id;
    return 'reembolsar';
  end if;

  if v_turno.estado in ('pendiente', 'confirmado') then
    update public.turnos
    set pago_estado = 'aprobado', pago_id = p_pago_id, pago_vence_at = null, estado = v_estado
    where id = p_turno_id;
    return v_estado::text;
  end if;

  -- El turno se liberó por falta de pago, pero el pago llegó: si el horario
  -- sigue libre se recupera; si no, queda marcado para devolver la seña.
  if v_turno.estado = 'cancelado' and v_turno.cancelado_por = 'sistema' then
    begin
      update public.turnos
      set pago_estado = 'aprobado', pago_id = p_pago_id, pago_vence_at = null, estado = v_estado,
          cancelado_at = null, cancelado_por = null
      where id = p_turno_id;
      return v_estado::text;
    exception when exclusion_violation then
      null;
    end;
  end if;

  update public.turnos set pago_estado = 'reembolsar', pago_id = p_pago_id where id = p_turno_id;
  return 'reembolsar';
end;
$$;

-- Disponibilidad: ignora las retenciones de seña ya vencidas -------------------
create or replace function public.horarios_libres(
  p_negocio_id     uuid,
  p_servicio_id    uuid,
  p_fecha          date,
  p_profesional_id uuid default null
)
returns table (profesional_id uuid, inicio timestamptz, fin timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with neg as (
    select n.zona_horaria, n.intervalo_min, n.anticipacion_min_min, n.anticipacion_max_dias
    from public.negocios n
    where n.id = p_negocio_id and n.activo
  ),
  srv as (
    select s.duracion_min
    from public.servicios s
    where s.id = p_servicio_id and s.negocio_id = p_negocio_id and s.activo
  ),
  profs as (
    select p.id
    from public.profesionales p
    join public.profesional_servicio ps on ps.profesional_id = p.id and ps.servicio_id = p_servicio_id
    where p.negocio_id = p_negocio_id
      and p.activo
      and (p_profesional_id is null or p.id = p_profesional_id)
  ),
  candidatos as (
    select
      h.profesional_id,
      (local_ts at time zone neg.zona_horaria) as inicio,
      (local_ts at time zone neg.zona_horaria) + make_interval(mins => srv.duracion_min) as fin
    from public.horarios_profesional h
    join profs on profs.id = h.profesional_id
    cross join neg
    cross join srv
    cross join lateral generate_series(
      p_fecha + h.desde,
      p_fecha + h.hasta - make_interval(mins => srv.duracion_min),
      make_interval(mins => neg.intervalo_min)
    ) as local_ts
    where h.dia_semana = extract(dow from p_fecha)
      and p_fecha <= (now() at time zone neg.zona_horaria)::date + neg.anticipacion_max_dias
  )
  select c.profesional_id, c.inicio, c.fin
  from candidatos c
  cross join neg
  where c.inicio >= now() + make_interval(mins => neg.anticipacion_min_min)
    and not exists (
      select 1 from public.turnos t
      where t.profesional_id = c.profesional_id
        and t.estado <> 'cancelado'
        and (t.pago_estado is distinct from 'pendiente' or t.pago_vence_at >= now())
        and tstzrange(t.inicio, t.fin, '[)') && tstzrange(c.inicio, c.fin, '[)')
    )
    and not exists (
      select 1 from public.bloqueos b
      where b.profesional_id = c.profesional_id
        and tstzrange(b.inicio, b.fin, '[)') && tstzrange(c.inicio, c.fin, '[)')
    )
  order by c.inicio, c.profesional_id;
$$;

-- Datos públicos: suma la seña que se pide (si corresponde) --------------------
create or replace function public.negocio_publico(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', n.id,
    'nombre', n.nombre,
    'slug', n.slug,
    'rubro', n.rubro,
    'telefono', n.telefono,
    'direccion', n.direccion,
    'descripcion', n.descripcion,
    'zona_horaria', n.zona_horaria,
    'cancelacion_min_horas', n.cancelacion_min_horas,
    'anticipacion_max_dias', n.anticipacion_max_dias,
    'pago_plazo_min', n.pago_plazo_min,
    'servicios', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', s.id,
          'nombre', s.nombre,
          'descripcion', s.descripcion,
          'duracion_min', s.duracion_min,
          'precio', s.precio,
          'sena', nullif(public.monto_sena(n, s.precio), 0),
          'profesional_ids', (
            select jsonb_agg(ps.profesional_id order by p.orden, p.nombre)
            from public.profesional_servicio ps
            join public.profesionales p on p.id = ps.profesional_id and p.activo
            where ps.servicio_id = s.id
          )
        ) order by s.orden, s.nombre)
      from public.servicios s
      where s.negocio_id = n.id
        and s.activo
        and exists (
          select 1 from public.profesional_servicio ps
          join public.profesionales p on p.id = ps.profesional_id and p.activo
          where ps.servicio_id = s.id
        )
    ), '[]'::jsonb),
    'profesionales', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'nombre', p.nombre) order by p.orden, p.nombre)
      from public.profesionales p
      where p.negocio_id = n.id and p.activo
    ), '[]'::jsonb)
  )
  from public.negocios n
  where n.slug = lower(p_slug) and n.activo;
$$;

-- Reserva online: ahora puede quedar retenida esperando la seña ----------------
drop function public.crear_reserva(uuid, uuid, uuid, timestamptz, text, text, text);

create function public.crear_reserva(
  p_negocio_id     uuid,
  p_servicio_id    uuid,
  p_profesional_id uuid,
  p_inicio         timestamptz,
  p_nombre         text,
  p_telefono       text,
  p_email          text default null
)
returns table (turno_id uuid, token text, sena numeric)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_neg        public.negocios;
  v_srv        public.servicios;
  v_nombre     text := trim(coalesce(p_nombre, ''));
  v_tel        text := public.normalizar_telefono(p_telefono);
  v_email      text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_fecha      date;
  v_cliente_id uuid;
  v_prof       record;
  v_sena       numeric;
  v_estado     public.estado_turno;
begin
  -- Validación de input (también se valida en la app con zod).
  if char_length(v_nombre) not between 2 and 80
     or v_tel is null or v_tel !~ '^[0-9]{8,15}$'
     or (v_email is not null and (char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'))
     or p_inicio is null then
    raise exception 'DATOS_INVALIDOS' using errcode = 'P0001';
  end if;

  select * into v_neg from public.negocios where id = p_negocio_id and activo;
  if not found then
    raise exception 'NEGOCIO_NO_DISPONIBLE' using errcode = 'P0001';
  end if;

  select * into v_srv from public.servicios
  where id = p_servicio_id and negocio_id = p_negocio_id and activo;
  if not found then
    raise exception 'HORARIO_NO_DISPONIBLE' using errcode = 'P0001';
  end if;

  -- Liberar retenciones de seña vencidas antes de contar y de insertar.
  perform public.vencer_pagos_pendientes(p_negocio_id);

  -- Freno anti-abuso: máximo 3 turnos futuros activos por teléfono y negocio.
  if (
    select count(*) from public.turnos t
    join public.clientes c on c.id = t.cliente_id
    where t.negocio_id = p_negocio_id
      and c.telefono = v_tel
      and t.estado in ('pendiente', 'confirmado')
      and t.inicio > now()
  ) >= 3 then
    raise exception 'LIMITE_TURNOS' using errcode = 'P0001';
  end if;

  insert into public.clientes (negocio_id, nombre, telefono, email)
  values (p_negocio_id, v_nombre, v_tel, v_email)
  on conflict (negocio_id, telefono)
    do update set email = coalesce(public.clientes.email, excluded.email)
  returning id into v_cliente_id;

  v_fecha := (p_inicio at time zone v_neg.zona_horaria)::date;
  v_sena := public.monto_sena(v_neg, v_srv.precio);
  -- Con seña, el turno queda pendiente hasta que se pague.
  v_estado := case
    when v_sena = 0 and v_neg.confirmacion_automatica then 'confirmado'
    else 'pendiente'
  end::public.estado_turno;

  -- Candidatos: profesionales libres exactamente en ese horario. Con "cualquiera"
  -- se prioriza al que tiene menos turnos ese día. Si dos personas reservan a la
  -- vez, la restricción de exclusión rechaza a una y se prueba con el siguiente.
  for v_prof in
    select h.profesional_id
    from public.horarios_libres(p_negocio_id, p_servicio_id, v_fecha, p_profesional_id) h
    where h.inicio = p_inicio
    order by (
      select count(*) from public.turnos t
      where t.profesional_id = h.profesional_id
        and t.estado <> 'cancelado'
        and (t.inicio at time zone v_neg.zona_horaria)::date = v_fecha
    ), random()
  loop
    begin
      insert into public.turnos (
        negocio_id, profesional_id, servicio_id, cliente_id, inicio, fin, estado, precio, origen,
        sena_monto, pago_estado, pago_vence_at
      ) values (
        p_negocio_id, v_prof.profesional_id, p_servicio_id, v_cliente_id,
        p_inicio, p_inicio + make_interval(mins => v_srv.duracion_min),
        v_estado, v_srv.precio, 'online',
        nullif(v_sena, 0),
        case when v_sena > 0 then 'pendiente' end,
        case when v_sena > 0 then now() + make_interval(mins => v_neg.pago_plazo_min) end
      )
      returning id, token_cancelacion into turno_id, token;
      sena := v_sena;
      return next;
      return;
    exception when exclusion_violation then
      -- Otro cliente ganó ese horario un instante antes: probar el siguiente.
      null;
    end;
  end loop;

  raise exception 'HORARIO_NO_DISPONIBLE' using errcode = 'P0001';
end;
$$;

-- Ver un turno con su token: suma estado del pago -------------------------------
create or replace function public.ver_turno(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', t.id,
    'estado', t.estado,
    'inicio', t.inicio,
    'fin', t.fin,
    'precio', t.precio,
    'servicio', s.nombre,
    'profesional', p.nombre,
    'cliente', c.nombre,
    'negocio', jsonb_build_object(
      'nombre', n.nombre, 'slug', n.slug, 'telefono', n.telefono,
      'direccion', n.direccion, 'zona_horaria', n.zona_horaria
    ),
    'cancelacion_min_horas', n.cancelacion_min_horas,
    'cancelable_hasta', t.inicio - make_interval(hours => n.cancelacion_min_horas),
    'cancelado_por', t.cancelado_por,
    'sena_monto', t.sena_monto,
    'pago_estado', case
      when t.pago_estado = 'pendiente' and t.pago_vence_at < now() then 'vencido'
      else t.pago_estado
    end,
    'pago_vence_at', t.pago_vence_at,
    'puede_cancelar', t.estado in ('pendiente', 'confirmado')
                      and now() <= t.inicio - make_interval(hours => n.cancelacion_min_horas)
  )
  from public.turnos t
  join public.negocios n on n.id = t.negocio_id
  join public.servicios s on s.id = t.servicio_id
  join public.profesionales p on p.id = t.profesional_id
  join public.clientes c on c.id = t.cliente_id
  where p_token ~ '^[0-9a-f]{64}$'
    and t.token_cancelacion = p_token;
$$;

-- Google Calendar: cola de sincronización ----------------------------------------
-- Turnos cuyo último cambio todavía no se reflejó en Google (o que se crearon
-- antes de conectar la cuenta). `version` es su updated_at al leerlos.
create or replace function public.turnos_para_sincronizar(p_limite integer default 50)
returns table (turno_id uuid, version timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.updated_at
  from public.turnos t
  where t.updated_at > coalesce(t.google_sincronizado_at, '-infinity'::timestamptz)
    and t.fin > now() - interval '7 days'
    and (
      t.google_event_id is not null
      or exists (
        select 1 from public.integraciones i
        where i.proveedor = 'google_calendar' and i.estado = 'activa' and i.profesional_id = t.profesional_id
      )
    )
  order by t.inicio
  limit least(greatest(p_limite, 1), 200);
$$;

-- Marca un turno como sincronizado. Si cambió desde que se leyó (otra versión),
-- guarda el evento pero lo deja en la cola para la próxima pasada.
create or replace function public.marcar_sincronizado_google(
  p_turno_id uuid,
  p_version  timestamptz,
  p_event_id text,
  p_prof_id  uuid
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.turnos
  set google_event_id = p_event_id,
      google_calendar_prof_id = p_prof_id,
      google_sincronizado_at = case when updated_at = p_version then now() else google_sincronizado_at end
  where id = p_turno_id;
$$;

-- Reemplaza los horarios ocupados importados de Google de un profesional en
-- [p_desde, p_hasta). p_ocupados: [{"inicio": "...", "fin": "..."}].
create or replace function public.reemplazar_bloqueos_google(
  p_profesional_id uuid,
  p_desde          timestamptz,
  p_hasta          timestamptz,
  p_ocupados       jsonb
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_negocio_id uuid;
  v_cantidad   integer;
begin
  select negocio_id into v_negocio_id from public.profesionales where id = p_profesional_id;
  if v_negocio_id is null then
    return 0;
  end if;

  delete from public.bloqueos
  where profesional_id = p_profesional_id
    and origen = 'google'
    and fin > p_desde
    and inicio < p_hasta;

  insert into public.bloqueos (negocio_id, profesional_id, inicio, fin, motivo, origen)
  select v_negocio_id, p_profesional_id, greatest((o ->> 'inicio')::timestamptz, p_desde),
         least((o ->> 'fin')::timestamptz, p_hasta), 'Ocupado en Google Calendar', 'google'
  from jsonb_array_elements(coalesce(p_ocupados, '[]'::jsonb)) as o
  where (o ->> 'inicio')::timestamptz < (o ->> 'fin')::timestamptz
    and (o ->> 'fin')::timestamptz > p_desde
    and (o ->> 'inicio')::timestamptz < p_hasta;
  get diagnostics v_cantidad = row_count;
  return v_cantidad;
end;
$$;

-- WhatsApp: recordatorios automáticos -------------------------------------------
-- Igual que reclamar_recordatorios (mail), pero para negocios con avisos por
-- WhatsApp activados; usa su propia marca para no pisarse con el mail.
create or replace function public.reclamar_recordatorios_whatsapp(p_limite integer default 100)
returns table (
  turno_id     uuid,
  token        text,
  inicio       timestamptz,
  cliente      text,
  telefono     text,
  servicio     text,
  negocio      text,
  zona_horaria text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return query
  with candidatos as (
    select t.id
    from public.turnos t
    join public.negocios n on n.id = t.negocio_id
    where n.whatsapp_avisos
      and n.recordatorio_horas > 0
      and t.estado in ('pendiente', 'confirmado')
      and t.pago_estado is distinct from 'pendiente'
      and t.recordatorio_wa_enviado_at is null
      and t.inicio > now() + interval '1 hour'
      and t.inicio <= now() + make_interval(hours => n.recordatorio_horas)
      and t.created_at < now() - interval '3 hours'
    order by t.inicio
    limit least(greatest(p_limite, 1), 500)
    for update of t skip locked
  ),
  marcados as (
    update public.turnos t
    set recordatorio_wa_enviado_at = now()
    from candidatos
    where t.id = candidatos.id
    returning t.*
  )
  select m.id, m.token_cancelacion, m.inicio, c.nombre, c.telefono, s.nombre, n.nombre, n.zona_horaria
  from marcados m
  join public.negocios n on n.id = m.negocio_id
  join public.clientes c on c.id = m.cliente_id
  join public.servicios s on s.id = m.servicio_id;
end;
$$;

-- El recordatorio por mail no debe salir mientras la seña está pendiente.
create or replace function public.reclamar_recordatorios(p_limite integer default 100)
returns table (
  turno_id      uuid,
  token         text,
  inicio        timestamptz,
  fin           timestamptz,
  cliente       text,
  email         text,
  servicio      text,
  profesional   text,
  negocio       text,
  slug          text,
  direccion     text,
  telefono      text,
  zona_horaria  text,
  cancelacion_min_horas integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return query
  with candidatos as (
    select t.id
    from public.turnos t
    join public.negocios n on n.id = t.negocio_id
    join public.clientes c on c.id = t.cliente_id
    where n.recordatorio_horas > 0
      and t.estado in ('pendiente', 'confirmado')
      and t.pago_estado is distinct from 'pendiente'
      and t.recordatorio_enviado_at is null
      and c.email is not null
      and t.inicio > now() + interval '1 hour'
      and t.inicio <= now() + make_interval(hours => n.recordatorio_horas)
      and t.created_at < now() - interval '3 hours'
    order by t.inicio
    limit least(greatest(p_limite, 1), 500)
    for update of t skip locked
  ),
  marcados as (
    update public.turnos t
    set recordatorio_enviado_at = now()
    from candidatos
    where t.id = candidatos.id
    returning t.*
  )
  select m.id, m.token_cancelacion, m.inicio, m.fin, c.nombre, c.email, s.nombre, p.nombre,
         n.nombre, n.slug, n.direccion, n.telefono, n.zona_horaria, n.cancelacion_min_horas
  from marcados m
  join public.negocios n on n.id = m.negocio_id
  join public.clientes c on c.id = m.cliente_id
  join public.servicios s on s.id = m.servicio_id
  join public.profesionales p on p.id = m.profesional_id;
end;
$$;

-- Estadísticas del panel (dueño) --------------------------------------------------
-- Resumen de un período [p_desde, p_hasta) para el negocio del usuario actual.
create or replace function public.estadisticas_negocio(p_desde timestamptz, p_hasta timestamptz)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_negocio_id uuid := public.mi_negocio_id();
begin
  if v_negocio_id is null or not public.es_dueno(v_negocio_id) then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;

  return (
    with base as (
      select t.*
      from public.turnos t
      where t.negocio_id = v_negocio_id and t.inicio >= p_desde and t.inicio < p_hasta
    )
    select jsonb_build_object(
      'total', (select count(*) from base),
      'activos', (select count(*) from base where estado in ('pendiente', 'confirmado', 'completado')),
      'cancelados', (select count(*) from base where estado = 'cancelado'),
      'cancelados_cliente', (select count(*) from base where estado = 'cancelado' and cancelado_por = 'cliente'),
      'online', (select count(*) from base where origen = 'online' and estado <> 'cancelado'),
      'ingresos', (select coalesce(sum(precio), 0) from base where estado in ('confirmado', 'completado')),
      'senas', (select coalesce(sum(sena_monto), 0) from base where pago_estado = 'aprobado'),
      'clientes_nuevos', (
        select count(*) from public.clientes c
        where c.negocio_id = v_negocio_id and c.created_at >= p_desde and c.created_at < p_hasta
      ),
      'por_servicio', coalesce((
        select jsonb_agg(x order by x.cantidad desc)
        from (
          select s.nombre, count(*) as cantidad, coalesce(sum(b.precio), 0) as ingresos
          from base b join public.servicios s on s.id = b.servicio_id
          where b.estado <> 'cancelado'
          group by s.nombre
        ) x
      ), '[]'::jsonb),
      'por_profesional', coalesce((
        select jsonb_agg(x order by x.cantidad desc)
        from (
          select p.nombre, p.color, count(*) as cantidad, coalesce(sum(b.precio), 0) as ingresos
          from base b join public.profesionales p on p.id = b.profesional_id
          where b.estado <> 'cancelado'
          group by p.nombre, p.color
        ) x
      ), '[]'::jsonb),
      'por_dia_semana', coalesce((
        select jsonb_agg(x order by x.dia)
        from (
          select extract(dow from b.inicio at time zone n.zona_horaria)::int as dia, count(*) as cantidad
          from base b join public.negocios n on n.id = b.negocio_id
          where b.estado <> 'cancelado'
          group by 1
        ) x
      ), '[]'::jsonb)
    )
  );
end;
$$;

-- Permisos de ejecución -----------------------------------------------------------
revoke execute on function public.consumir_limite(text, integer, integer) from public, anon, authenticated;
revoke execute on function public.vencer_pagos_pendientes(uuid) from public, anon, authenticated;
revoke execute on function public.monto_sena(public.negocios, numeric) from public, anon, authenticated;
revoke execute on function public.registrar_pago(uuid, text, boolean, numeric) from public, anon, authenticated;
revoke execute on function public.turnos_para_sincronizar(integer) from public, anon, authenticated;
revoke execute on function public.marcar_sincronizado_google(uuid, timestamptz, text, uuid) from public, anon, authenticated;
revoke execute on function public.reemplazar_bloqueos_google(uuid, timestamptz, timestamptz, jsonb) from public, anon, authenticated;
revoke execute on function public.reclamar_recordatorios_whatsapp(integer) from public, anon, authenticated;
revoke execute on function public.crear_reserva(uuid, uuid, uuid, timestamptz, text, text, text) from public;
revoke execute on function public.estadisticas_negocio(timestamptz, timestamptz) from public, anon;

grant execute on function public.consumir_limite(text, integer, integer) to service_role;
grant execute on function public.vencer_pagos_pendientes(uuid) to service_role;
grant execute on function public.monto_sena(public.negocios, numeric) to service_role;
grant execute on function public.registrar_pago(uuid, text, boolean, numeric) to service_role;
grant execute on function public.turnos_para_sincronizar(integer) to service_role;
grant execute on function public.marcar_sincronizado_google(uuid, timestamptz, text, uuid) to service_role;
grant execute on function public.reemplazar_bloqueos_google(uuid, timestamptz, timestamptz, jsonb) to service_role;
grant execute on function public.reclamar_recordatorios_whatsapp(integer) to service_role;
grant execute on function public.crear_reserva(uuid, uuid, uuid, timestamptz, text, text, text) to anon, authenticated;
grant execute on function public.estadisticas_negocio(timestamptz, timestamptz) to authenticated;
