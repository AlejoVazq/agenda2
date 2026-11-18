-- =============================================================================
-- 0013 · Servicio de emergencia.
--
-- Un servicio marcado como emergencia (p. ej. un corte un día que no se atiende)
-- no se reserva en el calendario: el portal lo muestra aparte, con el precio y un
-- link de WhatsApp al número del servicio o, si no tiene, al del negocio.
-- =============================================================================

alter table public.servicios
  add column emergencia boolean not null default false,
  -- Solo dígitos, normalizado con normalizar_telefono. Null = teléfono del negocio.
  add column contacto_whatsapp text check (contacto_whatsapp ~ '^[0-9]{8,15}$');

grant update (emergencia, contacto_whatsapp) on public.servicios to agenda2_usuario;

-- Portal público: igual que en la 0002, pero los de emergencia salen de 'servicios'
-- y van en 'emergencias' (sin profesionales ni duración; sin número no se publican).
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
          'whatsapp', coalesce(s.contacto_whatsapp, public.normalizar_telefono(n.telefono))
        ) order by s.orden, s.nombre)
      from public.servicios s
      where s.negocio_id = n.id
        and s.activo
        and s.emergencia
        and coalesce(s.contacto_whatsapp, public.normalizar_telefono(n.telefono)) is not null
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

-- Los servicios de emergencia no tienen horarios: así crear_reserva y
-- dias_disponibles (que usan esta función) tampoco los aceptan. Igual que en la 0001.
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
    where s.id = p_servicio_id and s.negocio_id = p_negocio_id and s.activo and not s.emergencia
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

