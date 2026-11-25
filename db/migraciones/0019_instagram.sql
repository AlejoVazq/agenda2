-- =============================================================================
-- 0019 · Instagram del negocio en la página de reservas.
--
-- negocios.instagram: el usuario sin @ (minúsculas, letras, números, punto y guion
-- bajo, hasta 30). Null = sin Instagram. La app acepta "@usuario" o el link del perfil
-- y guarda solo el usuario. negocio_publico lo suma; igual que en la 0016 en lo demás.
-- =============================================================================

alter table public.negocios
  add column instagram text check (instagram ~ '^[a-z0-9._]{1,30}$');

grant update (instagram) on public.negocios to agenda2_usuario;

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
    'instagram', n.instagram,
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
