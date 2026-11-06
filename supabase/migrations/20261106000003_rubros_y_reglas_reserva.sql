-- Peluquería masculina y femenina como rubros separados, y reglas definitivas de reserva.

alter table public.negocios drop constraint negocios_rubro_check;
update public.negocios set rubro = 'peluqueria_femenina' where rubro = 'peluqueria';
alter table public.negocios add constraint negocios_rubro_check
  check (rubro in ('peluqueria_masculina', 'peluqueria_femenina', 'barberia', 'unas', 'estetica', 'spa', 'otro'));

-- Email con el que se pidió cada turno online. El del cliente no alcanza: un celular
-- ya registrado conserva su primer email aunque después reserve con otro.
alter table public.turnos add column email_reserva text;
update public.turnos t set email_reserva = lower(c.email)
from public.clientes c
where c.id = t.cliente_id and t.origen = 'online' and c.email is not null;

-- Alta de negocio: las peluquerías arrancan con sus servicios típicos cargados -----
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

  insert into public.negocios (nombre, slug, rubro, telefono, direccion)
  values (trim(p_nombre), lower(trim(p_slug)), p_rubro, nullif(trim(p_telefono), ''), nullif(trim(p_direccion), ''))
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
    ('peluqueria_masculina', 'Corte de pelo', 30, 1),
    ('peluqueria_masculina', 'Corte y barba', 45, 2),
    ('peluqueria_masculina', 'Arreglo de barba', 20, 3),
    ('peluqueria_masculina', 'Corte infantil', 30, 4),
    ('peluqueria_femenina', 'Corte', 45, 1),
    ('peluqueria_femenina', 'Lavado y brushing', 45, 2),
    ('peluqueria_femenina', 'Color', 120, 3),
    ('peluqueria_femenina', 'Mechas', 150, 4),
    ('peluqueria_femenina', 'Peinado', 60, 5)
  ) as s(rubro, nombre, duracion, orden)
  where s.rubro = p_rubro;

  if v_prof_id is not null then
    insert into public.profesional_servicio (negocio_id, profesional_id, servicio_id)
    select v_negocio_id, v_prof_id, s.id from public.servicios s where s.negocio_id = v_negocio_id;
  end if;

  return v_negocio_id;
end;
$$;

-- Reserva online: un turno por fecha y por email; hasta 3 turnos futuros por local;
-- con 3 inasistencias sin perdonar, uno solo a la vez.
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

  -- Liberar retenciones de seña vencidas antes de contar y de insertar.
  perform public.vencer_pagos_pendientes(p_negocio_id);

  v_fecha := (p_inicio at time zone v_neg.zona_horaria)::date;

  -- Dos pedidos simultáneos del mismo email se atienden de a uno, así ambos
  -- no pasan los límites antes de que el otro haya guardado su turno.
  perform pg_advisory_xact_lock(hashtextextended(p_negocio_id::text || v_email, 0));

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
        sena_monto, pago_estado, pago_vence_at, email_reserva
      ) values (
        p_negocio_id, v_prof.profesional_id, p_servicio_id, v_cliente_id,
        p_inicio, p_inicio + make_interval(mins => v_srv.duracion_min),
        v_estado, v_srv.precio, 'online',
        nullif(v_sena, 0),
        case when v_sena > 0 then 'pendiente' end,
        case when v_sena > 0 then now() + make_interval(mins => v_neg.pago_plazo_min) end,
        v_email
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
