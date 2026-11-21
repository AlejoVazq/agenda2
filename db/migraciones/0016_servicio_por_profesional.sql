-- =============================================================================
-- 0016 · Precio y duración por profesional en cada servicio.
--
-- Dos profesionales pueden hacer el mismo servicio cobrando y tardando distinto.
-- profesional_servicio suma precio y duracion_min opcionales: null = usa los del
-- servicio. Lo que vale para un turno es coalesce(ps.x, s.x) del profesional que
-- lo atiende; si el profesional no tiene el servicio asignado (el panel lo
-- permite), valen los del servicio.
--
-- Se configura desde la pantalla del servicio (guardar_profesionales_servicio).
-- Los turnos ya cargados no cambian: guardan su precio y su fin.
-- =============================================================================

alter table public.profesional_servicio
  add column precio numeric(12, 2) check (precio >= 0),
  add column duracion_min integer check (duracion_min between 5 and 600);

-- Reemplaza quién hace un servicio y con qué precio y duración (dueño, atómico).
-- p_filas: [{"profesional_id": uuid, "precio": number|null, "duracion_min": int|null}]
create or replace function public.guardar_profesionales_servicio(p_servicio_id uuid, p_filas jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_negocio_id uuid;
begin
  select negocio_id into v_negocio_id from public.servicios where id = p_servicio_id;
  if v_negocio_id is null or not public.es_dueno(v_negocio_id) then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_filas, '[]'::jsonb)) <> 'array' then
    raise exception 'DATOS_INVALIDOS' using errcode = 'P0001';
  end if;

  delete from public.profesional_servicio where servicio_id = p_servicio_id;

  -- La FK compuesta (negocio_id, profesional_id) rechaza profesionales de otro negocio.
  insert into public.profesional_servicio (negocio_id, profesional_id, servicio_id, precio, duracion_min)
  select distinct on ((f->>'profesional_id')::uuid)
    v_negocio_id, (f->>'profesional_id')::uuid, p_servicio_id,
    (f->>'precio')::numeric, (f->>'duracion_min')::integer
  from jsonb_array_elements(coalesce(p_filas, '[]'::jsonb)) as f;
end;
$$;
grant execute on function public.guardar_profesionales_servicio(uuid, jsonb) to agenda2_usuario;

-- Horarios libres: la duración es la de cada profesional. Igual que en la 0013.
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
  profs as (
    select p.id, coalesce(ps.duracion_min, s.duracion_min) as duracion_min
    from public.profesionales p
    join public.profesional_servicio ps on ps.profesional_id = p.id and ps.servicio_id = p_servicio_id
    join public.servicios s on s.id = ps.servicio_id
    where p.negocio_id = p_negocio_id
      and p.activo
      and s.negocio_id = p_negocio_id and s.activo and not s.emergencia
      and (p_profesional_id is null or p.id = p_profesional_id)
  ),
  candidatos as (
    select
      h.profesional_id,
      (local_ts at time zone neg.zona_horaria) as inicio,
      (local_ts at time zone neg.zona_horaria) + make_interval(mins => profs.duracion_min) as fin
    from public.horarios_profesional h
    join profs on profs.id = h.profesional_id
    cross join neg
    cross join lateral generate_series(
      p_fecha + h.desde,
      p_fecha + h.hasta - make_interval(mins => profs.duracion_min),
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

-- Reserva online: fin, precio y seña del profesional que queda asignado. Igual que
-- en la 0008 en todo lo demás.
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
  v_clave      text := public.clave_email(p_email);
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
        and public.clave_email(coalesce(t.email_reserva, c.email)) = v_clave
    )
  into v_ausencias, v_futuros, v_del_dia
  from public.turnos t
  join public.clientes c on c.id = t.cliente_id
  where t.negocio_id = p_negocio_id
    and (c.telefono = v_tel or public.clave_email(c.email) = v_clave or public.clave_email(t.email_reserva) = v_clave);

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

  -- Candidatos: profesionales libres exactamente en ese horario. Con "cualquiera"
  -- se prioriza al que tiene menos turnos ese día. Si dos personas reservan a la
  -- vez, la restricción de exclusión rechaza a una y se prueba con el siguiente.
  for v_prof in
    select h.profesional_id, h.fin, coalesce(ps.precio, v_srv.precio) as precio
    from public.horarios_libres(p_negocio_id, p_servicio_id, v_fecha, p_profesional_id) h
    join public.profesional_servicio ps on ps.profesional_id = h.profesional_id and ps.servicio_id = p_servicio_id
    where h.inicio = p_inicio
    order by (
      select count(*) from public.turnos t
      where t.profesional_id = h.profesional_id
        and t.estado <> 'cancelado'
        and (t.inicio at time zone v_neg.zona_horaria)::date = v_fecha
    ), random()
  loop
    v_sena := public.monto_sena(v_neg, v_prof.precio);
    -- Con seña, el turno queda pendiente hasta que se pague.
    v_estado := case
      when v_sena = 0 and v_neg.confirmacion_automatica then 'confirmado'
      else 'pendiente'
    end::public.estado_turno;
    begin
      insert into public.turnos (
        negocio_id, profesional_id, servicio_id, cliente_id, inicio, fin, estado, precio, origen,
        sena_monto, pago_estado, pago_vence_at, email_reserva, nombre_reserva, telefono_reserva
      ) values (
        p_negocio_id, v_prof.profesional_id, p_servicio_id, v_cliente_id,
        p_inicio, v_prof.fin,
        v_estado, v_prof.precio, 'online',
        nullif(v_sena, 0),
        case when v_sena > 0 then 'pendiente' end,
        case when v_sena > 0 then now() + make_interval(mins => v_neg.pago_plazo_min) end,
        v_email, v_nombre, v_tel
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

-- Alta manual desde el panel: precio y duración del profesional. Igual que en la 0001.
create or replace function public.crear_turno_panel(
  p_profesional_id   uuid,
  p_servicio_id      uuid,
  p_inicio           timestamptz,
  p_cliente_nombre   text,
  p_cliente_telefono text,
  p_cliente_email    text default null,
  p_notas            text default null,
  p_fin              timestamptz default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_negocio_id uuid;
  v_es_dueno   boolean;
  v_precio     numeric;
  v_duracion   integer;
  v_tel        text := public.normalizar_telefono(p_cliente_telefono);
  v_nombre     text := trim(coalesce(p_cliente_nombre, ''));
  v_email      text := nullif(lower(trim(coalesce(p_cliente_email, ''))), '');
  v_cliente_id uuid;
  v_fin        timestamptz;
  v_id         uuid;
begin
  select negocio_id into v_negocio_id from public.profesionales where id = p_profesional_id;
  v_es_dueno := v_negocio_id is not null and public.es_dueno(v_negocio_id);
  if v_negocio_id is null
     or not (
       v_es_dueno
       or (public.es_miembro(v_negocio_id) and public.mi_profesional_id() = p_profesional_id)
     ) then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;

  select coalesce(ps.precio, s.precio), coalesce(ps.duracion_min, s.duracion_min)
    into v_precio, v_duracion
  from public.servicios s
  left join public.profesional_servicio ps on ps.servicio_id = s.id and ps.profesional_id = p_profesional_id
  where s.id = p_servicio_id and s.negocio_id = v_negocio_id;
  if not found then
    raise exception 'DATOS_INVALIDOS' using errcode = 'P0001';
  end if;

  if char_length(v_nombre) not between 2 and 80
     or v_tel is null or v_tel !~ '^[0-9]{8,15}$'
     or (v_email is not null and char_length(v_email) > 254)
     or p_inicio is null then
    raise exception 'DATOS_INVALIDOS' using errcode = 'P0001';
  end if;

  v_fin := coalesce(p_fin, p_inicio + make_interval(mins => v_duracion));
  if v_fin <= p_inicio then
    raise exception 'DATOS_INVALIDOS' using errcode = 'P0001';
  end if;

  -- El dueño completa el mail de una ficha que no lo tenía; un empleado no la toca.
  insert into public.clientes (negocio_id, nombre, telefono, email)
  values (v_negocio_id, v_nombre, v_tel, v_email)
  on conflict (negocio_id, telefono)
    do update set email = case
      when v_es_dueno then coalesce(public.clientes.email, excluded.email)
      else public.clientes.email
    end
  returning id into v_cliente_id;

  begin
    insert into public.turnos (
      negocio_id, profesional_id, servicio_id, cliente_id, inicio, fin, estado, precio, notas, origen,
      nombre_reserva, email_reserva, telefono_reserva
    ) values (
      v_negocio_id, p_profesional_id, p_servicio_id, v_cliente_id, p_inicio, v_fin,
      'confirmado', v_precio, nullif(trim(coalesce(p_notas, '')), ''), 'panel',
      v_nombre, v_email, v_tel
    )
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'HORARIO_NO_DISPONIBLE' using errcode = 'P0001';
  end;

  return v_id;
end;
$$;

-- Turnos fijos: precio del profesional al generar. Igual que en la 0015.
create or replace function public.generar_turnos_fijos(p_id uuid, p_hasta date)
returns table (turnos uuid[], salteadas date[])
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_f       public.turnos_fijos;
  v_tz      text;
  v_precio  numeric;
  v_activo  boolean;
  v_hoy     date;
  v_paso    integer;
  v_fecha   date;
  v_inicio  timestamptz;
  v_fin     timestamptz;
  v_id      uuid;
  v_creados uuid[] := '{}';
  v_salteo  date[] := '{}';
begin
  select * into v_f from public.turnos_fijos where id = p_id for update;
  if not found or v_f.terminado_at is not null then
    return query select v_creados, v_salteo;
    return;
  end if;

  select n.zona_horaria, coalesce(ps.precio, s.precio), (s.activo and p.activo)
    into v_tz, v_precio, v_activo
  from public.negocios n
  join public.servicios s on s.id = v_f.servicio_id
  join public.profesionales p on p.id = v_f.profesional_id
  left join public.profesional_servicio ps on ps.servicio_id = s.id and ps.profesional_id = p.id
  where n.id = v_f.negocio_id;

  if not v_activo or (v_f.generado_hasta is not null and v_f.generado_hasta >= p_hasta) then
    return query select v_creados, v_salteo;
    return;
  end if;

  v_hoy := (now() at time zone v_tz)::date;
  v_paso := 7 * v_f.cada_semanas;
  v_fecha := v_f.desde;
  -- Salta directo a la primera fecha que falta generar.
  if v_f.generado_hasta is not null and v_f.generado_hasta >= v_fecha then
    v_fecha := v_fecha + ((v_f.generado_hasta - v_fecha) / v_paso + 1) * v_paso;
  end if;

  while v_fecha <= p_hasta loop
    v_inicio := (v_fecha + v_f.hora) at time zone v_tz;
    v_fin := v_inicio + make_interval(mins => v_f.duracion_min);
    if v_inicio > now() then
      if exists (
        select 1 from public.bloqueos b
        where b.profesional_id = v_f.profesional_id and b.inicio < v_fin and b.fin > v_inicio
      ) then
        v_salteo := v_salteo || v_fecha;
      else
        begin
          insert into public.turnos (
            negocio_id, profesional_id, servicio_id, cliente_id, inicio, fin, estado, precio, notas, origen,
            nombre_reserva, email_reserva, telefono_reserva, turno_fijo_id
          ) values (
            v_f.negocio_id, v_f.profesional_id, v_f.servicio_id, v_f.cliente_id, v_inicio, v_fin,
            'confirmado', v_precio, v_f.notas, 'panel',
            v_f.nombre_reserva, v_f.email_reserva, v_f.telefono_reserva, v_f.id
          )
          returning id into v_id;
          v_creados := v_creados || v_id;
        exception when exclusion_violation then
          v_salteo := v_salteo || v_fecha;
        end;
      end if;
    end if;
    v_fecha := v_fecha + v_paso;
  end loop;

  update public.turnos_fijos set
    generado_hasta = greatest(coalesce(generado_hasta, p_hasta), p_hasta),
    -- Solo se guardan las que siguen por venir.
    fechas_salteadas = array(
      select distinct d from unnest(fechas_salteadas || v_salteo) d where d >= v_hoy order by d
    )
  where id = v_f.id;

  return query select v_creados, v_salteo;
end;
$$;

-- Alta de un turno fijo: la regla guarda la duración del profesional. Igual que en la 0015.
create or replace function public.crear_turno_fijo(
  p_profesional_id   uuid,
  p_servicio_id      uuid,
  p_inicio           timestamptz,
  p_cada_semanas     integer,
  p_cliente_nombre   text,
  p_cliente_telefono text,
  p_cliente_email    text default null,
  p_notas            text default null
)
returns table (id uuid, turnos uuid[], salteadas date[])
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_negocio    public.negocios;
  v_es_dueno   boolean;
  v_duracion   integer;
  v_tel        text := public.normalizar_telefono(p_cliente_telefono);
  v_nombre     text := trim(coalesce(p_cliente_nombre, ''));
  v_email      text := nullif(lower(trim(coalesce(p_cliente_email, ''))), '');
  v_cliente_id uuid;
  v_local      timestamp;
  v_id         uuid;
  v_gen        record;
begin
  select n.* into v_negocio
  from public.profesionales p join public.negocios n on n.id = p.negocio_id
  where p.id = p_profesional_id;
  v_es_dueno := v_negocio.id is not null and public.es_dueno(v_negocio.id);
  if v_negocio.id is null
     or not (
       v_es_dueno
       or (public.es_miembro(v_negocio.id) and public.mi_profesional_id() = p_profesional_id)
     ) then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;

  select coalesce(ps.duracion_min, s.duracion_min) into v_duracion
  from public.servicios s
  left join public.profesional_servicio ps on ps.servicio_id = s.id and ps.profesional_id = p_profesional_id
  where s.id = p_servicio_id and s.negocio_id = v_negocio.id;
  if not found then
    raise exception 'DATOS_INVALIDOS' using errcode = 'P0001';
  end if;

  if char_length(v_nombre) not between 2 and 80
     or v_tel is null or v_tel !~ '^[0-9]{8,15}$'
     or (v_email is not null and char_length(v_email) > 254)
     or p_inicio is null
     or p_cada_semanas is null or p_cada_semanas not in (1, 2) then
    raise exception 'DATOS_INVALIDOS' using errcode = 'P0001';
  end if;

  insert into public.clientes (negocio_id, nombre, telefono, email)
  values (v_negocio.id, v_nombre, v_tel, v_email)
  on conflict (negocio_id, telefono)
    do update set email = case
      when v_es_dueno then coalesce(public.clientes.email, excluded.email)
      else public.clientes.email
    end
  returning clientes.id into v_cliente_id;

  v_local := p_inicio at time zone v_negocio.zona_horaria;
  insert into public.turnos_fijos (
    negocio_id, profesional_id, servicio_id, cliente_id, desde, hora, cada_semanas, duracion_min,
    nombre_reserva, email_reserva, telefono_reserva, notas
  ) values (
    v_negocio.id, p_profesional_id, p_servicio_id, v_cliente_id, v_local::date, v_local::time, p_cada_semanas,
    v_duracion, v_nombre, v_email, v_tel, nullif(trim(coalesce(p_notas, '')), '')
  )
  returning turnos_fijos.id into v_id;

  select * into v_gen from public.generar_turnos_fijos(v_id, (now() at time zone v_negocio.zona_horaria)::date + 56);
  return query select v_id, v_gen.turnos, v_gen.salteadas;
end;
$$;

-- Portal público: cada servicio suma por_profesional ({id: {precio, duracion_min}},
-- valores efectivos). Igual que en la 0014 en todo lo demás.
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
    'reservas_habilitadas',
      plataforma.estado_suscripcion(n.prueba_hasta, n.pagado_hasta, n.suspendido_at) in ('activa', 'prueba', 'gracia'),
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
          ),
          'por_profesional', (
            select jsonb_object_agg(ps.profesional_id, jsonb_build_object(
                'precio', coalesce(ps.precio, s.precio),
                'duracion_min', coalesce(ps.duracion_min, s.duracion_min),
                'sena', nullif(public.monto_sena(n, coalesce(ps.precio, s.precio)), 0)
              ))
            from public.profesional_servicio ps
            join public.profesionales p on p.id = ps.profesional_id and p.activo
            where ps.servicio_id = s.id
          )
        ) order by s.orden, s.nombre)
      from public.servicios s
      where s.negocio_id = n.id
        and s.activo
        and not s.emergencia
        and exists (
          select 1 from public.profesional_servicio ps
          join public.profesionales p on p.id = ps.profesional_id and p.activo
          where ps.servicio_id = s.id
        )
    ), '[]'::jsonb),
    'emergencias', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', s.id,
          'nombre', s.nombre,
          'descripcion', s.descripcion,
          'precio', s.precio,
          'whatsapp', s.contacto_whatsapp
        ) order by s.orden, s.nombre)
      from public.servicios s
      where s.negocio_id = n.id
        and s.activo
        and s.emergencia
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
