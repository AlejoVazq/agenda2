-- =============================================================================
-- 0014 · El servicio de emergencia exige el WhatsApp de quien lo atiende.
--
-- Ya no se usa el teléfono del negocio como respaldo: sin número no se puede
-- marcar un servicio como de emergencia.
-- =============================================================================

alter table public.servicios
  add constraint servicios_emergencia_contacto check (not emergencia or contacto_whatsapp is not null);

-- Portal público: igual que en la 0013, con el número del servicio solamente.
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
