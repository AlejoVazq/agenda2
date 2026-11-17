-- =============================================================================
-- 0010 · Socios: más de un dueño por negocio, cada uno con su facturación.
--
-- Caso: dos peluqueros comparten el local (una página, una membresía), pero cada uno
-- tiene sus clientes y factura por su cuenta. Los dos son 'dueno' (perfiles ya lo
-- permitía); cada uno tiene su agenda (perfiles.profesional_id).
--
-- 1. estadisticas_negocio acepta un profesional opcional: todos los números salen
--    solo de esa agenda.
-- 2. Los avisos de la membresía les llegan a todos los dueños, no solo al primero.
-- =============================================================================

drop function public.estadisticas_negocio(timestamptz, timestamptz);

create function public.estadisticas_negocio(
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
begin
  if v_negocio_id is null or not public.es_dueno(v_negocio_id) then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;

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
      -- Con un profesional: las fichas nuevas del período que tienen algún turno con él.
      'clientes_nuevos', (
        select count(*) from public.clientes c
        where c.negocio_id = v_negocio_id and c.created_at >= p_desde and c.created_at < p_hasta
          and (p_profesional_id is null or exists (
            select 1 from public.turnos t where t.cliente_id = c.id and t.profesional_id = p_profesional_id
          ))
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

grant execute on function public.estadisticas_negocio(timestamptz, timestamptz, uuid) to agenda2_usuario;

-- Avisos de la membresía: una fila por dueño (el cron manda un mail a cada uno). ------
create or replace function plataforma.reclamar_avisos_suscripcion()
returns table (
  negocio_id   uuid,
  tipo         text,
  nombre       text,
  estado       text,
  vence        timestamptz,
  fin_servicio timestamptz,
  dueno_nombre text,
  dueno_email  text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with base as (
    select n.id, n.nombre, n.prueba_hasta, n.pagado_hasta, n.suspendido_at,
           greatest(n.prueba_hasta, coalesce(n.pagado_hasta, n.prueba_hasta)) as vence,
           plataforma.estado_suscripcion(n.prueba_hasta, n.pagado_hasta, n.suspendido_at) as estado,
           plataforma.fin_servicio(n.prueba_hasta, n.pagado_hasta, n.suspendido_at) as fin
    from public.negocios n
    where n.suspendido_at is null and n.activo
  ),
  candidatos as (
    select b.*, case
        when b.estado = 'activa' and b.vence <= now() + interval '4 days' then 'por_vencer'
        when b.estado = 'prueba' and b.vence <= now() + interval '2 days' then 'por_vencer'
        when b.estado = 'gracia' then 'vencio'
        when b.estado = 'vencida' and b.fin > now() - interval '3 days' then 'bloqueado'
      end as tipo
    from base b
  ),
  marcados as (
    insert into plataforma.avisos_suscripcion (negocio_id, tipo, vence)
    select c.id, c.tipo, c.vence from candidatos c where c.tipo is not null
    on conflict do nothing
    returning avisos_suscripcion.negocio_id, avisos_suscripcion.tipo
  )
  select c.id, c.tipo, c.nombre, c.estado, c.vence, c.fin, pe.nombre, u."email"
  from marcados m
  join candidatos c on c.id = m.negocio_id and c.tipo = m.tipo
  join public.perfiles pe on pe.negocio_id = c.id and pe.rol = 'dueno'
  join auth."user" u on u."id" = pe.id
  order by c.id, pe.created_at;
end;
$$;
