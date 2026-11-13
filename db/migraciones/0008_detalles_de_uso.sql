-- =============================================================================
-- 0008 · Detalles de uso anotados el 2026-11-06.
--
-- * Alias de mail: juan+algo@gmail.com, j.u.a.n@gmail.com y JUAN@googlemail.com son el
--   mismo buzón. public.clave_email() los lleva a una sola forma y crear_reserva compara
--   con ella, así un alias no esquiva el turno por día ni los 3 futuros por local. El
--   mail se sigue guardando tal como lo escribió la persona.
-- * La página de reservas mostraba como máximo 62 días aunque el negocio eligiera 90:
--   dias_disponibles acepta hasta 92.
-- * Ficha del cliente: el aviso de "3 inasistencias" y "Quitar límite" miraban solo esa
--   ficha, pero crear_reserva cruza celular y mail. Ahora usan la misma regla
--   (inasistencias_que_limitan / quitar_limite_cliente, con RLS: solo el dueño).
-- * Estadísticas: los turnos de servicios sin precio no suman "$ 0"; se cuentan aparte
--   (sin_precio) y por servicio/profesional el ingreso queda en null si no hay precios.
-- =============================================================================

create or replace function public.clave_email(p_email text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when e is null or position('@' in e) = 0 then e
    else (
      with partes as (
        select split_part(e, '@', 1) as usuario, split_part(e, '@', 2) as dominio
      )
      select case
          when dominio in ('gmail.com', 'googlemail.com')
            then replace(split_part(usuario, '+', 1), '.', '') || '@gmail.com'
          else split_part(usuario, '+', 1) || '@' || dominio
        end
      from partes
    )
  end
  from (select nullif(lower(trim(coalesce(p_email, ''))), '') as e) x;
$$;
grant execute on function public.clave_email(text) to agenda2_usuario, agenda2_servidor;

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
        sena_monto, pago_estado, pago_vence_at, email_reserva, nombre_reserva, telefono_reserva
      ) values (
        p_negocio_id, v_prof.profesional_id, p_servicio_id, v_cliente_id,
        p_inicio, p_inicio + make_interval(mins => v_srv.duracion_min),
        v_estado, v_srv.precio, 'online',
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

create or replace function public.dias_disponibles(
  p_negocio_id     uuid,
  p_servicio_id    uuid,
  p_desde          date,
  p_dias           integer default 31,
  p_profesional_id uuid default null
)
returns setof date
language sql
stable
security definer
set search_path = ''
as $$
  select d::date
  from generate_series(p_desde, p_desde + (least(greatest(p_dias, 1), 92) - 1), interval '1 day') as d
  where exists (
    select 1 from public.horarios_libres(p_negocio_id, p_servicio_id, d::date, p_profesional_id)
  )
  order by 1;
$$;

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
      'online', (select count(*) from base where origen = 'online' and estado not in ('cancelado', 'ausente')),
      'ingresos', (select coalesce(sum(precio), 0) from base where estado in ('confirmado', 'completado')),
      'sin_precio', (select count(*) from base where estado in ('confirmado', 'completado') and precio is null),
      'senas', (select coalesce(sum(sena_monto), 0) from base where pago_estado = 'aprobado'),
      'clientes_nuevos', (
        select count(*) from public.clientes c
        where c.negocio_id = v_negocio_id and c.created_at >= p_desde and c.created_at < p_hasta
      ),
      'por_servicio', coalesce((
        select jsonb_agg(x order by x.cantidad desc)
        from (
          select s.nombre, count(*) as cantidad, sum(b.precio) as ingresos
          from base b join public.servicios s on s.id = b.servicio_id
          where b.estado not in ('cancelado', 'ausente')
          group by s.nombre
        ) x
      ), '[]'::jsonb),
      'por_profesional', coalesce((
        select jsonb_agg(x order by x.cantidad desc)
        from (
          select p.nombre, p.color, count(*) as cantidad, sum(b.precio) as ingresos
          from base b join public.profesionales p on p.id = b.profesional_id
          where b.estado not in ('cancelado', 'ausente')
          group by p.nombre, p.color
        ) x
      ), '[]'::jsonb),
      'por_dia_semana', coalesce((
        select jsonb_agg(x order by x.dia)
        from (
          select extract(dow from b.inicio at time zone n.zona_horaria)::int as dia, count(*) as cantidad
          from base b join public.negocios n on n.id = b.negocio_id
          where b.estado not in ('cancelado', 'ausente')
          group by 1
        ) x
      ), '[]'::jsonb)
    )
  );
end;
$$;

-- Turnos que cuentan para el límite de inasistencias de la persona de esta ficha: los de
-- cualquier ficha con su celular o su mail, o reservados con su mail (como crear_reserva).
create or replace function public.turnos_de_la_persona(p_cliente_id uuid)
returns setof public.turnos
language sql
stable
security invoker
set search_path = ''
as $$
  select t.*
  from public.clientes yo
  join public.clientes c on c.negocio_id = yo.negocio_id
  join public.turnos t on t.cliente_id = c.id
  where yo.id = p_cliente_id
    and (
      c.telefono = yo.telefono
      or (yo.email is not null and (
        public.clave_email(c.email) = public.clave_email(yo.email)
        or public.clave_email(t.email_reserva) = public.clave_email(yo.email)
      ))
    );
$$;

create or replace function public.inasistencias_que_limitan(p_cliente_id uuid)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*)::integer
  from public.turnos_de_la_persona(p_cliente_id) t
  join public.clientes c on c.id = t.cliente_id
  where t.estado = 'ausente' and t.inicio > coalesce(c.ausencias_perdonadas_at, '-infinity');
$$;

-- Perdona las inasistencias en todas las fichas que cuentan. Devuelve cuántas tocó.
create or replace function public.quitar_limite_cliente(p_cliente_id uuid)
returns integer
language sql
volatile
security invoker
set search_path = ''
as $$
  with fichas as (
    select p_cliente_id as id
    union
    select t.cliente_id from public.turnos_de_la_persona(p_cliente_id) t
  ), hecho as (
    update public.clientes c set ausencias_perdonadas_at = now()
    where c.id in (select id from fichas)
    returning 1
  )
  select count(*)::integer from hecho;
$$;

grant execute on function public.turnos_de_la_persona(uuid) to agenda2_usuario;
grant execute on function public.inasistencias_que_limitan(uuid) to agenda2_usuario;
grant execute on function public.quitar_limite_cliente(uuid) to agenda2_usuario;
