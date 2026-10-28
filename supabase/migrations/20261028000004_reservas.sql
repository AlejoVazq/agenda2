-- =============================================================================
-- Disponibilidad y reservas.
--
-- El portal público (rol anon) solo accede a la base a través de estas
-- funciones security definer, que devuelven exclusivamente lo necesario
-- y validan todo su input por sí mismas (no confían en la aplicación).
-- =============================================================================

create or replace function public.normalizar_telefono(p_telefono text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(regexp_replace(coalesce(p_telefono, ''), '[^0-9]', '', 'g'), '');
$$;

-- Datos públicos de un negocio: info básica, servicios y profesionales activos. -
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
    'servicios', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', s.id,
          'nombre', s.nombre,
          'descripcion', s.descripcion,
          'duracion_min', s.duracion_min,
          'precio', s.precio,
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

-- Horarios libres de un día (fecha local del negocio). -------------------------
-- Cruza: horario semanal del profesional, duración del servicio, turnos
-- existentes (no cancelados), bloqueos y la ventana de anticipación del negocio.
-- p_profesional_id null = "cualquier profesional que haga el servicio".
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
        and tstzrange(t.inicio, t.fin, '[)') && tstzrange(c.inicio, c.fin, '[)')
    )
    and not exists (
      select 1 from public.bloqueos b
      where b.profesional_id = c.profesional_id
        and tstzrange(b.inicio, b.fin, '[)') && tstzrange(c.inicio, c.fin, '[)')
    )
  order by c.inicio, c.profesional_id;
$$;

-- Días (desde p_desde, hasta p_dias) que tienen al menos un horario libre. ------
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
  from generate_series(p_desde, p_desde + (least(greatest(p_dias, 1), 62) - 1), interval '1 day') as d
  where exists (
    select 1 from public.horarios_libres(p_negocio_id, p_servicio_id, d::date, p_profesional_id)
  )
  order by 1;
$$;

-- Reserva online (sin cuenta). ---------------------------------------------------
-- Devuelve el id del turno y su token secreto para ver/cancelar.
-- Errores (en el mensaje): DATOS_INVALIDOS, NEGOCIO_NO_DISPONIBLE,
-- HORARIO_NO_DISPONIBLE, LIMITE_TURNOS.
create or replace function public.crear_reserva(
  p_negocio_id     uuid,
  p_servicio_id    uuid,
  p_profesional_id uuid,
  p_inicio         timestamptz,
  p_nombre         text,
  p_telefono       text,
  p_email          text default null
)
returns table (turno_id uuid, token text)
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
        negocio_id, profesional_id, servicio_id, cliente_id, inicio, fin, estado, precio, origen
      ) values (
        p_negocio_id, v_prof.profesional_id, p_servicio_id, v_cliente_id,
        p_inicio, p_inicio + make_interval(mins => v_srv.duracion_min),
        case when v_neg.confirmacion_automatica then 'confirmado' else 'pendiente' end::public.estado_turno,
        v_srv.precio, 'online'
      )
      returning id, token_cancelacion into turno_id, token;
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

-- Ver un turno con su token (página de confirmación, sin login). -----------------
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

-- Cancelar un turno con su token, respetando la política del negocio. ------------
-- Errores: TURNO_NO_ENCONTRADO, NO_CANCELABLE, FUERA_DE_PLAZO.
create or replace function public.cancelar_turno_cliente(p_token text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_turno public.turnos;
  v_horas integer;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'TURNO_NO_ENCONTRADO' using errcode = 'P0001';
  end if;

  select t.* into v_turno from public.turnos t where t.token_cancelacion = p_token for update;
  if not found then
    raise exception 'TURNO_NO_ENCONTRADO' using errcode = 'P0001';
  end if;

  if v_turno.estado not in ('pendiente', 'confirmado') then
    raise exception 'NO_CANCELABLE' using errcode = 'P0001';
  end if;

  select cancelacion_min_horas into v_horas from public.negocios where id = v_turno.negocio_id;
  if now() > v_turno.inicio - make_interval(hours => v_horas) then
    raise exception 'FUERA_DE_PLAZO' using errcode = 'P0001';
  end if;

  update public.turnos
  set estado = 'cancelado', cancelado_at = now(), cancelado_por = 'cliente'
  where id = v_turno.id;
end;
$$;

-- Alta manual de un turno desde el panel (dueño, o empleado en su agenda). ------
-- No exige que caiga dentro del horario semanal (el negocio puede hacer
-- excepciones), pero la restricción de exclusión impide superposiciones.
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
  v_srv        public.servicios;
  v_tel        text := public.normalizar_telefono(p_cliente_telefono);
  v_nombre     text := trim(coalesce(p_cliente_nombre, ''));
  v_email      text := nullif(lower(trim(coalesce(p_cliente_email, ''))), '');
  v_cliente_id uuid;
  v_fin        timestamptz;
  v_id         uuid;
begin
  select negocio_id into v_negocio_id from public.profesionales where id = p_profesional_id;
  if v_negocio_id is null
     or not (
       public.es_dueno(v_negocio_id)
       or (public.es_miembro(v_negocio_id) and public.mi_profesional_id() = p_profesional_id)
     ) then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;

  select * into v_srv from public.servicios where id = p_servicio_id and negocio_id = v_negocio_id;
  if not found then
    raise exception 'DATOS_INVALIDOS' using errcode = 'P0001';
  end if;

  if char_length(v_nombre) not between 2 and 80
     or v_tel is null or v_tel !~ '^[0-9]{8,15}$'
     or (v_email is not null and char_length(v_email) > 254)
     or p_inicio is null then
    raise exception 'DATOS_INVALIDOS' using errcode = 'P0001';
  end if;

  v_fin := coalesce(p_fin, p_inicio + make_interval(mins => v_srv.duracion_min));
  if v_fin <= p_inicio then
    raise exception 'DATOS_INVALIDOS' using errcode = 'P0001';
  end if;

  insert into public.clientes (negocio_id, nombre, telefono, email)
  values (v_negocio_id, v_nombre, v_tel, v_email)
  on conflict (negocio_id, telefono)
    do update set email = coalesce(public.clientes.email, excluded.email)
  returning id into v_cliente_id;

  begin
    insert into public.turnos (
      negocio_id, profesional_id, servicio_id, cliente_id, inicio, fin, estado, precio, notas, origen
    ) values (
      v_negocio_id, p_profesional_id, p_servicio_id, v_cliente_id, p_inicio, v_fin,
      'confirmado', v_srv.precio, nullif(trim(coalesce(p_notas, '')), ''), 'panel'
    )
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'HORARIO_NO_DISPONIBLE' using errcode = 'P0001';
  end;

  return v_id;
end;
$$;

-- Permisos de ejecución -----------------------------------------------------------
revoke execute on function public.negocio_publico(text) from public;
revoke execute on function public.horarios_libres(uuid, uuid, date, uuid) from public;
revoke execute on function public.dias_disponibles(uuid, uuid, date, integer, uuid) from public;
revoke execute on function public.crear_reserva(uuid, uuid, uuid, timestamptz, text, text, text) from public;
revoke execute on function public.ver_turno(text) from public;
revoke execute on function public.cancelar_turno_cliente(text) from public;
revoke execute on function public.crear_turno_panel(uuid, uuid, timestamptz, text, text, text, text, timestamptz) from public, anon;

grant execute on function public.negocio_publico(text) to anon, authenticated;
grant execute on function public.horarios_libres(uuid, uuid, date, uuid) to anon, authenticated;
grant execute on function public.dias_disponibles(uuid, uuid, date, integer, uuid) to anon, authenticated;
grant execute on function public.crear_reserva(uuid, uuid, uuid, timestamptz, text, text, text) to anon, authenticated;
grant execute on function public.ver_turno(text) to anon, authenticated;
grant execute on function public.cancelar_turno_cliente(text) to anon, authenticated;
grant execute on function public.crear_turno_panel(uuid, uuid, timestamptz, text, text, text, text, timestamptz) to authenticated;
