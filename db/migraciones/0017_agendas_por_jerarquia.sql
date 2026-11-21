-- =============================================================================
-- 0017 · Agendas separadas por jerarquía y foto de cada profesional.
--
-- Con socios (0010) cualquier dueño veía la agenda, los turnos y la facturación de
-- todos. Ahora:
--   * el titular (el dueño más antiguo) ve todas las agendas;
--   * un socio ve la suya y las que no son de ningún dueño (empleados y
--     profesionales sin usuario), no la del titular ni la de otros socios;
--   * un empleado, la suya (como antes).
-- public.ve_agenda() lo decide y lo usan las políticas de turnos, turnos fijos,
-- ausencias, horarios (escrituras) e integraciones, y las funciones que crean o
-- terminan turnos. Las estadísticas son security invoker: se filtran solas.
-- Sigue compartido lo del negocio: servicios, profesionales, clientes, página.
--
-- Foto de profesional: como los logos (0006), solo el rol del servidor; se ve en
-- el panel.
-- =============================================================================

-- El titular es el dueño más antiguo (quien creó el negocio).
create or replace function public.es_titular(p_negocio_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select p.id = app.usuario_id()
    from public.perfiles p
    where p.negocio_id = p_negocio_id and p.rol = 'dueno'
    order by p.created_at, p.id
    limit 1
  ), false);
$$;

-- ¿El usuario actual ve esta agenda?
create or replace function public.ve_agenda(p_negocio_id uuid, p_profesional_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.perfiles yo
    where yo.id = app.usuario_id()
      and yo.negocio_id = p_negocio_id
      and (
        yo.profesional_id = p_profesional_id
        or (yo.rol = 'dueno' and (
          public.es_titular(p_negocio_id)
          -- Un socio: las agendas que no son de otro dueño.
          or not exists (
            select 1 from public.perfiles otro
            where otro.negocio_id = p_negocio_id and otro.rol = 'dueno' and otro.profesional_id = p_profesional_id
          )
        ))
      )
  );
$$;

grant execute on function public.es_titular(uuid) to agenda2_usuario;
grant execute on function public.ve_agenda(uuid, uuid) to agenda2_usuario;

-- Políticas --------------------------------------------------------------------
drop policy turnos_select on public.turnos;
drop policy turnos_update on public.turnos;
create policy turnos_select on public.turnos
  for select to agenda2_usuario using (public.ve_agenda(negocio_id, profesional_id));
create policy turnos_update on public.turnos
  for update to agenda2_usuario
  using (public.ve_agenda(negocio_id, profesional_id))
  with check (public.ve_agenda(negocio_id, profesional_id));

drop policy turnos_fijos_select on public.turnos_fijos;
create policy turnos_fijos_select on public.turnos_fijos
  for select to agenda2_usuario using (public.ve_agenda(negocio_id, profesional_id));

drop policy bloqueos_select on public.bloqueos;
drop policy bloqueos_insert on public.bloqueos;
drop policy bloqueos_update on public.bloqueos;
drop policy bloqueos_delete on public.bloqueos;
create policy bloqueos_select on public.bloqueos
  for select to agenda2_usuario using (public.ve_agenda(negocio_id, profesional_id));
create policy bloqueos_insert on public.bloqueos
  for insert to agenda2_usuario with check (public.ve_agenda(negocio_id, profesional_id));
create policy bloqueos_update on public.bloqueos
  for update to agenda2_usuario
  using (public.ve_agenda(negocio_id, profesional_id))
  with check (public.ve_agenda(negocio_id, profesional_id));
create policy bloqueos_delete on public.bloqueos
  for delete to agenda2_usuario using (public.ve_agenda(negocio_id, profesional_id));

-- Horarios: se leen todos (son del negocio); los cambia un dueño que ve esa agenda.
drop policy horarios_insert on public.horarios_profesional;
drop policy horarios_update on public.horarios_profesional;
drop policy horarios_delete on public.horarios_profesional;
create policy horarios_insert on public.horarios_profesional
  for insert to agenda2_usuario
  with check (public.es_dueno(negocio_id) and public.ve_agenda(negocio_id, profesional_id));
create policy horarios_update on public.horarios_profesional
  for update to agenda2_usuario
  using (public.es_dueno(negocio_id) and public.ve_agenda(negocio_id, profesional_id))
  with check (public.es_dueno(negocio_id) and public.ve_agenda(negocio_id, profesional_id));
create policy horarios_delete on public.horarios_profesional
  for delete to agenda2_usuario
  using (public.es_dueno(negocio_id) and public.ve_agenda(negocio_id, profesional_id));

-- Integraciones: las del negocio (sin profesional) y las de las agendas que ve.
drop policy integraciones_select on public.integraciones;
create policy integraciones_select on public.integraciones
  for select to agenda2_usuario
  using (public.es_dueno(negocio_id) and (profesional_id is null or public.ve_agenda(negocio_id, profesional_id)));

-- Funciones que crean o terminan turnos -------------------------------------------
-- crear_turno_panel: igual que en la 0016, con ve_agenda en lugar de "dueño o su agenda".
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
  if v_negocio_id is null or not public.ve_agenda(v_negocio_id, p_profesional_id) then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  v_es_dueno := public.es_dueno(v_negocio_id);

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

-- crear_turno_fijo: igual que en la 0016, con ve_agenda.
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
  if v_negocio.id is null or not public.ve_agenda(v_negocio.id, p_profesional_id) then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  v_es_dueno := public.es_dueno(v_negocio.id);

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

-- terminar_turno_fijo: igual que en la 0015, con ve_agenda.
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
  if not found or not public.ve_agenda(v_f.negocio_id, v_f.profesional_id) then
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

-- Límite de inasistencias: es la regla de reserva de todo el local, así que se
-- cuenta con todos los turnos aunque el socio no vea algunas agendas.
create or replace function public.inasistencias_que_limitan(p_cliente_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- Como antes (con RLS): quien no es dueño de esa ficha no ve nada.
  if not exists (select 1 from public.clientes c where c.id = p_cliente_id and public.es_dueno(c.negocio_id)) then
    return 0;
  end if;
  return (
    select count(*)::integer
    from public.turnos_de_la_persona(p_cliente_id) t
    join public.clientes c on c.id = t.cliente_id
    where t.estado = 'ausente' and t.inicio > coalesce(c.ausencias_perdonadas_at, '-infinity')
  );
end;
$$;

create or replace function public.quitar_limite_cliente(p_cliente_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if not exists (select 1 from public.clientes c where c.id = p_cliente_id and public.es_dueno(c.negocio_id)) then
    return 0;
  end if;
  with fichas as (
    select p_cliente_id as id
    union
    select t.cliente_id from public.turnos_de_la_persona(p_cliente_id) t
  ), hecho as (
    update public.clientes c set ausencias_perdonadas_at = now()
    where c.id in (select id from fichas)
    returning 1
  )
  select count(*)::integer into v_n from hecho;
  return v_n;
end;
$$;

-- Estadísticas: igual que en la 0010; para quien no es titular, "clientes nuevos"
-- sin profesional cuenta solo fichas con algún turno que ve (RLS).
create or replace function public.estadisticas_negocio(
  p_desde          timestamptz,
  p_hasta          timestamptz,
  p_profesional_id uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_negocio_id uuid := public.mi_negocio_id();
  v_titular    boolean;
begin
  if v_negocio_id is null or not public.es_dueno(v_negocio_id) then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  v_titular := public.es_titular(v_negocio_id);

  return (
    with base as (
      select t.*
      from public.turnos t
      where t.negocio_id = v_negocio_id and t.inicio >= p_desde and t.inicio < p_hasta
        and (p_profesional_id is null or t.profesional_id = p_profesional_id)
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
          and (
            (p_profesional_id is null and v_titular)
            or exists (
              select 1 from public.turnos t
              where t.cliente_id = c.id and (p_profesional_id is null or t.profesional_id = p_profesional_id)
            )
          )
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

-- Foto de cada profesional ---------------------------------------------------------
create table public.profesional_fotos (
  profesional_id uuid primary key references public.profesionales (id) on delete cascade,
  tipo           text not null check (tipo in ('image/png', 'image/jpeg', 'image/webp')),
  datos          bytea not null check (octet_length(datos) between 1 and 524288),
  actualizado_at timestamptz not null default now()
);
alter table public.profesional_fotos enable row level security;

revoke all on public.profesional_fotos from public, agenda2_usuario, agenda2_anonimo;
grant select, insert, update, delete on public.profesional_fotos to agenda2_servidor;
