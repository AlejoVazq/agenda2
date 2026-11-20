-- =============================================================================
-- 0015 · Turnos fijos.
--
-- Un cliente que viene siempre el mismo día y horario (todas las semanas o cada
-- 2 semanas) queda con una regla en turnos_fijos. La regla genera turnos reales
-- para las próximas 8 semanas (así bloquean el horario, mandan recordatorio y
-- cuentan en las estadísticas como cualquier otro) y el cron va completando.
--
-- Ocurrencias: desde + 7 · cada_semanas · k, a la hora local del negocio. Si una
-- fecha choca con otro turno o con una ausencia, se saltea y queda anotada en
-- fechas_salteadas. Una fecha ya generada no se vuelve a crear (generado_hasta),
-- aunque después se haya cancelado ese turno. Terminar la regla cancela los
-- turnos futuros que siguen activos.
--
-- Como en turnos, la regla guarda los datos con que se pidió: un empleado no lee
-- fichas de clientes.
-- =============================================================================

create table public.turnos_fijos (
  id               uuid primary key default gen_random_uuid(),
  negocio_id       uuid not null references public.negocios (id) on delete cascade,
  profesional_id   uuid not null,
  servicio_id      uuid not null,
  cliente_id       uuid not null references public.clientes (id) on delete cascade,
  desde            date not null,
  hora             time not null,
  cada_semanas     integer not null check (cada_semanas in (1, 2)),
  duracion_min     integer not null check (duracion_min > 0),
  nombre_reserva   text not null,
  email_reserva    text,
  telefono_reserva text not null,
  notas            text check (char_length(notas) <= 500),
  generado_hasta   date,
  fechas_salteadas date[] not null default '{}',
  terminado_at     timestamptz,
  created_at       timestamptz not null default now(),
  foreign key (negocio_id, profesional_id) references public.profesionales (negocio_id, id),
  foreign key (negocio_id, servicio_id) references public.servicios (negocio_id, id)
);

create index turnos_fijos_negocio_idx on public.turnos_fijos (negocio_id) where terminado_at is null;
create index turnos_fijos_cliente_idx on public.turnos_fijos (cliente_id);

alter table public.turnos_fijos enable row level security;

-- Igual que turnos: el dueño todo su negocio; el empleado solo su agenda.
-- Altas, cambios y bajas solo por las funciones de abajo.
create policy turnos_fijos_select on public.turnos_fijos
  for select to agenda2_usuario
  using (public.es_dueno(negocio_id) or (public.es_miembro(negocio_id) and profesional_id = public.mi_profesional_id()));

grant select on public.turnos_fijos to agenda2_usuario;
grant select, insert, update, delete on public.turnos_fijos to agenda2_servidor;

create trigger turnos_fijos_habilitado before insert or update or delete on public.turnos_fijos
  for each row execute function plataforma.tg_exigir_habilitado('negocio_id');

alter table public.turnos
  add column turno_fijo_id uuid references public.turnos_fijos (id) on delete set null;
create index turnos_turno_fijo_idx on public.turnos (turno_fijo_id) where turno_fijo_id is not null;

-- Genera las ocurrencias que faltan hasta p_hasta (fecha local). Devuelve los
-- turnos creados y las fechas salteadas en esta corrida. Interna: la llaman las
-- funciones de abajo, que ya verificaron permisos.
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

  select n.zona_horaria, s.precio, (s.activo and p.activo)
    into v_tz, v_precio, v_activo
  from public.negocios n
  join public.servicios s on s.id = v_f.servicio_id
  join public.profesionales p on p.id = v_f.profesional_id
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

-- Alta desde el panel (dueño, o empleado en su agenda). Mismas validaciones que
-- crear_turno_panel. Crea la regla y las primeras 8 semanas.
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
  v_srv        public.servicios;
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

  select * into v_srv from public.servicios where servicios.id = p_servicio_id and negocio_id = v_negocio.id;
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
    v_srv.duracion_min, v_nombre, v_email, v_tel, nullif(trim(coalesce(p_notas, '')), '')
  )
  returning turnos_fijos.id into v_id;

  select * into v_gen from public.generar_turnos_fijos(v_id, (now() at time zone v_negocio.zona_horaria)::date + 56);
  return query select v_id, v_gen.turnos, v_gen.salteadas;
end;
$$;

-- Termina la regla y cancela sus turnos por venir. Devuelve los cancelados.
create or replace function public.terminar_turno_fijo(p_id uuid)
returns uuid[]
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_f public.turnos_fijos;
  v_ids uuid[];
begin
  select * into v_f from public.turnos_fijos where id = p_id for update;
  if not found
     or not (
       public.es_dueno(v_f.negocio_id)
       or (public.es_miembro(v_f.negocio_id) and public.mi_profesional_id() = v_f.profesional_id)
     ) then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if v_f.terminado_at is not null then
    return '{}';
  end if;

  update public.turnos_fijos set terminado_at = now(), fechas_salteadas = '{}' where id = p_id;
  with cancelados as (
    update public.turnos set estado = 'cancelado', cancelado_at = now(), cancelado_por = 'negocio'
    where turno_fijo_id = p_id and inicio > now() and estado in ('pendiente', 'confirmado')
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_ids from cancelados;
  return v_ids;
end;
$$;

-- Cron: completa la ventana de 8 semanas de todas las reglas activas de negocios
-- que toman reservas. Devuelve cuántos turnos creó.
create or replace function public.completar_turnos_fijos()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_f record;
  v_gen record;
  v_total integer := 0;
begin
  for v_f in
    select f.id, (now() at time zone n.zona_horaria)::date + 56 as hasta
    from public.turnos_fijos f
    join public.negocios n on n.id = f.negocio_id
    where f.terminado_at is null
      and (f.generado_hasta is null or f.generado_hasta < (now() at time zone n.zona_horaria)::date + 56)
      and plataforma.negocio_toma_reservas(f.negocio_id)
  loop
    select * into v_gen from public.generar_turnos_fijos(v_f.id, v_f.hasta);
    v_total := v_total + coalesce(cardinality(v_gen.turnos), 0);
  end loop;
  return v_total;
end;
$$;

grant execute on function public.crear_turno_fijo(uuid, uuid, timestamptz, integer, text, text, text, text) to agenda2_usuario;
grant execute on function public.terminar_turno_fijo(uuid) to agenda2_usuario;
grant execute on function public.completar_turnos_fijos() to agenda2_servidor;
