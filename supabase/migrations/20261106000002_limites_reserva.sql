-- Límites de la reserva online: un turno por día y menos turnos tras una inasistencia.

-- Las inasistencias anteriores a esta fecha no limitan al cliente ("Quitar límite").
alter table public.clientes add column ausencias_perdonadas_at timestamptz;
-- RLS (clientes_update) deja hacerlo solo al dueño.
grant update (ausencias_perdonadas_at) on public.clientes to authenticated;

-- Reserva online: el email pasa a ser obligatorio y se aplican los límites ---------
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
  v_hoy        date;
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

  -- Liberar retenciones de seña vencidas antes de contar y de insertar.
  perform public.vencer_pagos_pendientes(p_negocio_id);

  v_fecha := (p_inicio at time zone v_neg.zona_horaria)::date;
  v_hoy := (now() at time zone v_neg.zona_horaria)::date;

  -- Dos pedidos simultáneos del mismo email se atienden de a uno, así ambos
  -- no pasan los límites antes de que el otro haya guardado su turno.
  perform pg_advisory_xact_lock(hashtextextended(p_negocio_id::text || v_email, 0));

  -- Se busca por celular y por email, para que no alcance con cambiar uno de los dos.
  select
    count(*) filter (where t.estado = 'ausente' and t.inicio > coalesce(c.ausencias_perdonadas_at, '-infinity')),
    count(*) filter (where t.estado in ('pendiente', 'confirmado') and t.inicio > now()),
    count(*) filter (
      where t.estado <> 'cancelado'
        and (
          (t.inicio at time zone v_neg.zona_horaria)::date = v_fecha
          or (t.origen = 'online' and (t.created_at at time zone v_neg.zona_horaria)::date = v_hoy)
        )
    )
  into v_ausencias, v_futuros, v_del_dia
  from public.turnos t
  join public.clientes c on c.id = t.cliente_id
  where t.negocio_id = p_negocio_id
    and (c.telefono = v_tel or lower(c.email) = v_email);

  -- Con una inasistencia sin perdonar, solo un turno futuro a la vez.
  if v_ausencias >= 1 and v_futuros >= 1 then
    raise exception 'LIMITE_AUSENCIAS' using errcode = 'P0001';
  end if;

  -- Freno anti-abuso: máximo 3 turnos futuros activos por cliente y negocio.
  if v_futuros >= 3 then
    raise exception 'LIMITE_TURNOS' using errcode = 'P0001';
  end if;

  -- Un turno por día: ni dos turnos para la misma fecha, ni dos pedidos online en el
  -- mismo día. Los cancelados no cuentan, así se puede cancelar y elegir otro.
  if v_del_dia >= 1 then
    raise exception 'LIMITE_DIARIO' using errcode = 'P0001';
  end if;

  insert into public.clientes (negocio_id, nombre, telefono, email)
  values (p_negocio_id, v_nombre, v_tel, v_email)
  on conflict (negocio_id, telefono)
    do update set email = coalesce(public.clientes.email, excluded.email)
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

-- Estadísticas: una inasistencia no es un turno atendido ni un ingreso -------------
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
          where b.estado not in ('cancelado', 'ausente')
          group by s.nombre
        ) x
      ), '[]'::jsonb),
      'por_profesional', coalesce((
        select jsonb_agg(x order by x.cantidad desc)
        from (
          select p.nombre, p.color, count(*) as cantidad, coalesce(sum(b.precio), 0) as ingresos
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
