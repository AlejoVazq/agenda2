-- =============================================================================
-- 0004 · Último ingreso de cada usuario, para el panel del admin.
--
-- Antes se calculaba con las sesiones abiertas, pero cerrar sesión las borra y
-- quedaba "nunca". Ahora un trigger anota la fecha cada vez que Better Auth abre
-- una sesión (en los admins, recién después del código del segundo factor).
-- admin_negocios y admin_negocio quedan iguales que en la 0002, leyendo de acá.
-- =============================================================================

create table plataforma.ultimos_ingresos (
  usuario_id uuid primary key references auth."user" ("id") on delete cascade,
  at         timestamptz not null default now()
);
alter table plataforma.ultimos_ingresos enable row level security;
-- Sin políticas ni grants: lo escribe el trigger y lo leen las funciones del admin.

create or replace function plataforma.tg_registrar_ingreso()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into plataforma.ultimos_ingresos (usuario_id, at) values (new."userId", now())
  on conflict (usuario_id) do update set at = excluded.at;
  return new;
end;
$$;

create trigger session_registrar_ingreso after insert on auth."session"
  for each row execute function plataforma.tg_registrar_ingreso();

-- Lo que ya hay: las sesiones abiertas.
insert into plataforma.ultimos_ingresos (usuario_id, at)
select "userId", max("createdAt") from auth."session" group by "userId"
on conflict do nothing;

create or replace function plataforma.admin_negocios()
returns table (
  id               uuid,
  nombre           text,
  slug             text,
  rubro            text,
  telefono         text,
  created_at       timestamptz,
  dueno_nombre     text,
  dueno_email      text,
  dueno_verificado boolean,
  ultimo_ingreso   timestamptz,
  estado           text,
  prueba_hasta     timestamptz,
  pagado_hasta     timestamptz,
  fin_servicio     timestamptz,
  profesionales    integer,
  turnos_30d       integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform plataforma.requerir_admin();
  return query
    select
      n.id, n.nombre, n.slug, n.rubro, n.telefono, n.created_at,
      d.nombre, u."email", u."emailVerified",
      (select max(ui.at) from plataforma.ultimos_ingresos ui
        join public.perfiles pe on pe.id = ui.usuario_id where pe.negocio_id = n.id),
      plataforma.estado_suscripcion(n.prueba_hasta, n.pagado_hasta, n.suspendido_at),
      n.prueba_hasta, n.pagado_hasta,
      plataforma.fin_servicio(n.prueba_hasta, n.pagado_hasta, n.suspendido_at),
      (select count(*)::integer from public.profesionales p where p.negocio_id = n.id and p.activo),
      (select count(*)::integer from public.turnos t
        where t.negocio_id = n.id and t.estado <> 'cancelado' and t.inicio >= now() - interval '30 days' and t.inicio < now())
    from public.negocios n
    left join lateral (
      select pe.id, pe.nombre from public.perfiles pe
      where pe.negocio_id = n.id and pe.rol = 'dueno' order by pe.created_at limit 1
    ) d on true
    left join auth."user" u on u."id" = d.id
    order by n.created_at desc;
end;
$$;

create or replace function plataforma.admin_negocio(p_negocio_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform plataforma.requerir_admin();
  select jsonb_build_object(
    'id', n.id,
    'nombre', n.nombre,
    'slug', n.slug,
    'rubro', n.rubro,
    'telefono', n.telefono,
    'direccion', n.direccion,
    'created_at', n.created_at,
    'estado', plataforma.estado_suscripcion(n.prueba_hasta, n.pagado_hasta, n.suspendido_at),
    'prueba_hasta', n.prueba_hasta,
    'pagado_hasta', n.pagado_hasta,
    'fin_servicio', plataforma.fin_servicio(n.prueba_hasta, n.pagado_hasta, n.suspendido_at),
    'suspendido_at', n.suspendido_at,
    'suspension_motivo', n.suspension_motivo,
    'equipo', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', pe.id,
          'nombre', pe.nombre,
          'rol', pe.rol,
          'email', u."email",
          'email_verificado', u."emailVerified",
          'ultimo_ingreso', (select ui.at from plataforma.ultimos_ingresos ui where ui.usuario_id = pe.id)
        ) order by pe.rol, pe.nombre)
      from public.perfiles pe join auth."user" u on u."id" = pe.id
      where pe.negocio_id = n.id
    ), '[]'::jsonb),
    'profesionales', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', p.id,
          'nombre', p.nombre,
          'activo', p.activo,
          'tiene_usuario', exists (select 1 from public.perfiles pe where pe.profesional_id = p.id),
          'horarios', coalesce((
            select jsonb_agg(jsonb_build_object('dia_semana', h.dia_semana, 'desde', h.desde, 'hasta', h.hasta)
              order by h.dia_semana, h.desde)
            from public.horarios_profesional h where h.profesional_id = p.id
          ), '[]'::jsonb),
          'servicios', (select count(*) from public.profesional_servicio ps where ps.profesional_id = p.id)
        ) order by p.orden, p.nombre)
      from public.profesionales p where p.negocio_id = n.id
    ), '[]'::jsonb),
    'servicios', coalesce((
      select jsonb_agg(jsonb_build_object('nombre', s.nombre, 'duracion_min', s.duracion_min, 'activo', s.activo)
        order by s.orden, s.nombre)
      from public.servicios s where s.negocio_id = n.id
    ), '[]'::jsonb),
    'uso', jsonb_build_object(
      'turnos_30d', (select count(*) from public.turnos t
        where t.negocio_id = n.id and t.estado <> 'cancelado' and t.inicio >= now() - interval '30 days' and t.inicio < now()),
      'turnos_futuros', (select count(*) from public.turnos t
        where t.negocio_id = n.id and t.estado not in ('cancelado', 'ausente') and t.inicio >= now()),
      'online_30d', (select count(*) from public.turnos t
        where t.negocio_id = n.id and t.origen = 'online' and t.created_at >= now() - interval '30 days'),
      'clientes', (select count(*) from public.clientes c where c.negocio_id = n.id)
    ),
    'pagos', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', pg.id, 'monto', pg.monto, 'medio', pg.medio, 'meses', pg.meses,
          'periodo_desde', pg.periodo_desde, 'periodo_hasta', pg.periodo_hasta, 'nota', pg.nota,
          'anulado_at', pg.anulado_at, 'anulado_motivo', pg.anulado_motivo, 'created_at', pg.created_at
        ) order by pg.created_at desc)
      from plataforma.pagos pg where pg.negocio_id = n.id
    ), '[]'::jsonb),
    'notas', coalesce((
      select jsonb_agg(jsonb_build_object('id', nt.id, 'texto', nt.texto, 'created_at', nt.created_at,
          'autor', (select u."name" from auth."user" u where u."id" = nt.autor_id))
        order by nt.created_at desc)
      from plataforma.notas nt where nt.negocio_id = n.id
    ), '[]'::jsonb),
    'auditoria', coalesce((
      select jsonb_agg(x.fila order by x.created_at desc) from (
        select a.created_at, jsonb_build_object('accion', a.accion, 'detalle', a.detalle, 'created_at', a.created_at,
            'admin', (select u."name" from auth."user" u where u."id" = a.admin_id)) as fila
        from plataforma.auditoria a where a.negocio_id = n.id
        order by a.created_at desc limit 50
      ) x
    ), '[]'::jsonb)
  ) into v
  from public.negocios n where n.id = p_negocio_id;

  if v is null then
    raise exception 'NO_ENCONTRADO' using errcode = 'P0002';
  end if;
  return v;
end;
$$;
