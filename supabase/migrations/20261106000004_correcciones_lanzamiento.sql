-- Correcciones previas a la versión preliminar.

-- Permisos -------------------------------------------------------------------------
-- Los proyectos nuevos de Supabase ya no exponen las tablas de public por defecto.
-- RLS sigue decidiendo qué filas ve cada uno; los update por columna ya están otorgados.
grant select, insert, update, delete on all tables in schema public to service_role;
grant select, insert, delete on public.bloqueos, public.clientes, public.horarios_profesional,
  public.negocios, public.profesionales, public.servicios, public.turnos to authenticated;
grant select, insert, update, delete on public.perfiles, public.profesional_servicio to authenticated;
grant select on public.integraciones to authenticated;

-- Celular en un solo formato -------------------------------------------------------
-- Argentina: 10 dígitos, sin 54, 9, 0 ni 15. Otros países quedan como están.
-- La misma regla está en normalizarTelefono (src/lib/whatsapp.ts).
create or replace function public.normalizar_telefono(p_telefono text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  n text := regexp_replace(coalesce(p_telefono, ''), '[^0-9]', '', 'g');
  largo integer;
begin
  if n = '' then
    return null;
  end if;
  if n like '00%' then
    n := substr(n, 3);
  end if;
  if n like '549%' and char_length(n) = 13 then
    return substr(n, 4);
  end if;
  if n like '54%' and char_length(n) = 12 then
    return substr(n, 3);
  end if;
  if n like '54%' and char_length(n) > 12 then
    n := regexp_replace(substr(n, 3), '^9', '');
  end if;
  if n like '0%' then
    n := substr(n, 2);
  end if;
  -- Característica de 2 a 4 dígitos seguida de "15" (forma local de los celulares).
  if char_length(n) = 12 then
    for largo in 2..4 loop
      if substr(n, largo + 1, 2) = '15' then
        n := left(n, largo) || substr(n, largo + 3);
        exit;
      end if;
    end loop;
  end if;
  return n;
end;
$$;

-- Unifica los clientes existentes: si el mismo celular quedó en dos fichas, se juntan.
do $$
declare
  r record;
  v_destino uuid;
begin
  for r in
    select id, negocio_id, email, public.normalizar_telefono(telefono) as normal
    from public.clientes
    where telefono <> public.normalizar_telefono(telefono)
    order by created_at
  loop
    select id into v_destino from public.clientes
    where negocio_id = r.negocio_id and telefono = r.normal and id <> r.id;
    if found then
      update public.turnos set cliente_id = v_destino where cliente_id = r.id;
      update public.clientes set email = coalesce(email, r.email) where id = v_destino;
      delete from public.clientes where id = r.id;
    else
      update public.clientes set telefono = r.normal where id = r.id;
    end if;
  end loop;
end;
$$;

-- Cada turno online guarda quién lo pidió ------------------------------------------
-- Una reserva anónima no puede leer ni modificar la ficha de quien ya usó ese celular.
alter table public.turnos add column nombre_reserva text;

-- Un turno futuro no puede figurar como atendido ni como inasistencia ---------------
create function public.validar_estado_turno()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.estado in ('ausente', 'completado') and new.inicio > now() then
    raise exception 'TURNO_FUTURO' using errcode = 'P0001';
  end if;
  -- Al cambiar de horario, el recordatorio se vuelve a mandar.
  if tg_op = 'UPDATE' and new.inicio is distinct from old.inicio then
    new.recordatorio_enviado_at := null;
    new.recordatorio_wa_enviado_at := null;
  end if;
  return new;
end;
$$;

create trigger turnos_validar_estado before insert or update on public.turnos
  for each row execute function public.validar_estado_turno();

-- Alta de negocio: barbería con los servicios de peluquería masculina, e intervalo
-- de 10 minutos para que los servicios cortos no dejen huecos.
create or replace function public.crear_negocio(
  p_nombre        text,
  p_slug          text,
  p_rubro         text,
  p_nombre_dueno  text,
  p_telefono      text default null,
  p_direccion     text default null,
  p_dueno_atiende boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid         uuid := auth.uid();
  v_negocio_id  uuid;
  v_prof_id     uuid;
begin
  if v_uid is null then
    raise exception 'NO_AUTENTICADO' using errcode = '28000';
  end if;

  if exists (select 1 from public.perfiles where id = v_uid) then
    raise exception 'YA_TIENE_NEGOCIO' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.negocios where slug = lower(p_slug)) then
    raise exception 'SLUG_OCUPADO' using errcode = 'P0001';
  end if;

  insert into public.negocios (nombre, slug, rubro, telefono, direccion, intervalo_min)
  values (
    trim(p_nombre), lower(trim(p_slug)), p_rubro, nullif(trim(p_telefono), ''), nullif(trim(p_direccion), ''),
    case when p_rubro in ('peluqueria_masculina', 'barberia') then 10 else 15 end
  )
  returning id into v_negocio_id;

  if p_dueno_atiende then
    insert into public.profesionales (negocio_id, nombre)
    values (v_negocio_id, trim(p_nombre_dueno))
    returning id into v_prof_id;
  end if;

  insert into public.perfiles (id, negocio_id, rol, nombre, profesional_id)
  values (v_uid, v_negocio_id, 'dueno', trim(p_nombre_dueno), v_prof_id);

  -- Sin precio: cada negocio pone el suyo.
  insert into public.servicios (negocio_id, nombre, duracion_min, orden)
  select v_negocio_id, s.nombre, s.duracion, s.orden
  from (values
    ('masculino', 'Corte de pelo', 30, 1),
    ('masculino', 'Corte y barba', 45, 2),
    ('masculino', 'Arreglo de barba', 20, 3),
    ('masculino', 'Corte infantil', 30, 4),
    ('femenino', 'Corte', 45, 1),
    ('femenino', 'Lavado y brushing', 45, 2),
    ('femenino', 'Color', 120, 3),
    ('femenino', 'Mechas', 150, 4),
    ('femenino', 'Peinado', 60, 5)
  ) as s(tipo, nombre, duracion, orden)
  where s.tipo = case p_rubro
    when 'peluqueria_masculina' then 'masculino'
    when 'barberia' then 'masculino'
    when 'peluqueria_femenina' then 'femenino'
  end;

  if v_prof_id is not null then
    insert into public.profesional_servicio (negocio_id, profesional_id, servicio_id)
    select v_negocio_id, v_prof_id, s.id from public.servicios s where s.negocio_id = v_negocio_id;
  end if;

  return v_negocio_id;
end;
$$;

-- Reserva online -------------------------------------------------------------------
-- Solo desde el servidor de la app, para que el límite por IP no se pueda esquivar.
create or replace function public.crear_reserva(
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
  v_ausencias  integer;
  v_futuros    integer;
  v_del_dia    integer;
begin
  -- Validación de input (también se valida en la app con zod).
  if char_length(v_nombre) not between 2 and 80
     or v_tel is null or v_tel !~ '^[0-9]{8,15}$'
     or v_email is null or char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
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

  -- Las reservas de un local se atienden de a una: los límites cruzan email y
  -- celular, así que un candado por cada dato dejaría pasar pedidos simultáneos.
  perform pg_advisory_xact_lock(hashtextextended(p_negocio_id::text, 0));

  -- Liberar retenciones de seña vencidas antes de contar y de insertar.
  perform public.vencer_pagos_pendientes(p_negocio_id);

  v_fecha := (p_inicio at time zone v_neg.zona_horaria)::date;

  select
    count(*) filter (where t.estado = 'ausente' and t.inicio > coalesce(c.ausencias_perdonadas_at, '-infinity')),
    count(*) filter (where t.estado in ('pendiente', 'confirmado') and t.inicio > now()),
    -- Solo por email: quienes comparten un celular pueden reservar el mismo día.
    count(*) filter (
      where t.estado <> 'cancelado'
        and (t.inicio at time zone v_neg.zona_horaria)::date = v_fecha
        and coalesce(t.email_reserva, lower(c.email)) = v_email
    )
  into v_ausencias, v_futuros, v_del_dia
  from public.turnos t
  join public.clientes c on c.id = t.cliente_id
  where t.negocio_id = p_negocio_id
    and (c.telefono = v_tel or lower(c.email) = v_email or t.email_reserva = v_email);

  if v_ausencias >= 3 and v_futuros >= 1 then
    raise exception 'LIMITE_AUSENCIAS' using errcode = 'P0001';
  end if;

  if v_futuros >= 3 then
    raise exception 'LIMITE_TURNOS' using errcode = 'P0001';
  end if;

  if v_del_dia >= 1 then
    raise exception 'LIMITE_DIARIO' using errcode = 'P0001';
  end if;

  -- Una ficha existente no se toca: quien reserva es anónimo y no prueba ser su dueño.
  insert into public.clientes (negocio_id, nombre, telefono, email)
  values (p_negocio_id, v_nombre, v_tel, v_email)
  on conflict (negocio_id, telefono)
    do update set telefono = public.clientes.telefono
  returning id into v_cliente_id;

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
        sena_monto, pago_estado, pago_vence_at, email_reserva, nombre_reserva
      ) values (
        p_negocio_id, v_prof.profesional_id, p_servicio_id, v_cliente_id,
        p_inicio, p_inicio + make_interval(mins => v_srv.duracion_min),
        v_estado, v_srv.precio, 'online',
        nullif(v_sena, 0),
        case when v_sena > 0 then 'pendiente' end,
        case when v_sena > 0 then now() + make_interval(mins => v_neg.pago_plazo_min) end,
        v_email, v_nombre
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

revoke execute on function public.crear_reserva(uuid, uuid, uuid, timestamptz, text, text, text) from public, anon, authenticated;
grant execute on function public.crear_reserva(uuid, uuid, uuid, timestamptz, text, text, text) to service_role;

-- Ver un turno con su token: el nombre con el que se reservó ------------------------
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
    'cliente', coalesce(t.nombre_reserva, c.nombre),
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

-- Recordatorios: a quien pidió el turno, no a quien tiene la ficha -------------------
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
      and coalesce(t.email_reserva, c.email) is not null
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
  select m.id, m.token_cancelacion, m.inicio, m.fin, coalesce(m.nombre_reserva, c.nombre),
         coalesce(m.email_reserva, c.email), s.nombre, p.nombre,
         n.nombre, n.slug, n.direccion, n.telefono, n.zona_horaria, n.cancelacion_min_horas
  from marcados m
  join public.negocios n on n.id = m.negocio_id
  join public.clientes c on c.id = m.cliente_id
  join public.servicios s on s.id = m.servicio_id
  join public.profesionales p on p.id = m.profesional_id;
end;
$$;

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
  select m.id, m.token_cancelacion, m.inicio, coalesce(m.nombre_reserva, c.nombre), c.telefono, s.nombre, n.nombre, n.zona_horaria
  from marcados m
  join public.negocios n on n.id = m.negocio_id
  join public.clientes c on c.id = m.cliente_id
  join public.servicios s on s.id = m.servicio_id;
end;
$$;
