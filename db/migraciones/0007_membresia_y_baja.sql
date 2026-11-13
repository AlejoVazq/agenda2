-- =============================================================================
-- 0007 · Etapas de la membresía, aviso del día 26 y eliminar un negocio.
--
-- Los estados siguen saliendo de las fechas (0002), pero cambia qué permite cada uno:
--
--   prueba / activa   todo funciona
--   gracia            (5 días desde que vence) el panel queda en SOLO LECTURA, pero la
--                     página sigue tomando reservas: sus clientes no pagan las consecuencias
--   vencida           apagado: no entra al panel (lo frena la app, src/lib/auth.ts) y la
--                     página no toma reservas. Los datos quedan guardados; si paga, vuelve todo
--   suspendida        "dado de baja" por el admin: igual que vencida, sin importar lo pagado
--
-- Por eso hay dos chequeos:
--   plataforma.negocio_habilitado      escrituras del panel   (prueba, activa)
--   plataforma.negocio_toma_reservas   turnos online nuevos   (prueba, activa, gracia)
--
-- Aviso por mail antes de vencer: 4 días antes en el plan pago (el día 26 de un mes de
-- 30) y 2 días antes en la prueba de 7.
--
-- plataforma.admin_eliminar: borra el negocio (con todos sus datos), las cuentas de su
-- equipo, o las dos cosas. Pide el nombre exacto del negocio, nunca borra la cuenta de
-- un admin y deja en la auditoría un resumen de lo borrado (la auditoría no tiene FK).
-- =============================================================================

create or replace function plataforma.negocio_habilitado(p_negocio_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select plataforma.estado_suscripcion(prueba_hasta, pagado_hasta, suspendido_at) in ('activa', 'prueba')
    from public.negocios where id = p_negocio_id
  ), false);
$$;

create or replace function plataforma.negocio_toma_reservas(p_negocio_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select plataforma.estado_suscripcion(prueba_hasta, pagado_hasta, suspendido_at) in ('activa', 'prueba', 'gracia')
    from public.negocios where id = p_negocio_id
  ), false);
$$;
grant execute on function plataforma.negocio_toma_reservas(uuid) to agenda2_usuario, agenda2_servidor;

-- Panel (app.usuario_id fijado, no admin): necesita estar habilitado, también para
-- crear turnos. Turno nuevo desde afuera del panel (reserva online): alcanza con que
-- tome reservas. El resto (cancelación del cliente, cron, avisos) sigue andando.
create or replace function plataforma.tg_exigir_habilitado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fila    jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  v_negocio uuid := (v_fila ->> tg_argv[0])::uuid;
  v_panel   boolean := nullif(current_setting('app.usuario_id', true), '') is not null;
begin
  if v_panel then
    if not plataforma.es_admin() and not plataforma.negocio_habilitado(v_negocio) then
      raise exception 'NEGOCIO_NO_HABILITADO' using errcode = 'P0001',
        hint = 'La suscripción del negocio venció o está dada de baja: el panel está en solo lectura.';
    end if;
  elsif tg_table_name = 'turnos' and tg_op = 'INSERT' and not plataforma.negocio_toma_reservas(v_negocio) then
    raise exception 'NEGOCIO_NO_HABILITADO' using errcode = 'P0001',
      hint = 'El negocio no está tomando reservas.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- Avisos: el de "por vencer" sale 4 días antes en el plan pago y 2 en la prueba. ------
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
  join lateral (
    select p.id, p.nombre from public.perfiles p
    where p.negocio_id = c.id and p.rol = 'dueno' order by p.created_at limit 1
  ) pe on true
  join auth."user" u on u."id" = pe.id;
end;
$$;

-- Eliminar ---------------------------------------------------------------------------
create or replace function plataforma.admin_eliminar(
  p_negocio_id    uuid,
  p_confirmacion  text,
  p_borrar_negocio boolean,
  p_borrar_cuentas boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin   uuid := plataforma.requerir_admin();
  v_neg     public.negocios;
  v_cuentas uuid[];
  v_resumen jsonb;
begin
  if not coalesce(p_borrar_negocio, false) and not coalesce(p_borrar_cuentas, false) then
    raise exception 'NADA_QUE_BORRAR' using errcode = 'P0001';
  end if;
  select * into v_neg from public.negocios where id = p_negocio_id for update;
  if not found then
    raise exception 'NO_ENCONTRADO' using errcode = 'P0002';
  end if;
  if lower(trim(coalesce(p_confirmacion, ''))) <> lower(trim(v_neg.nombre)) then
    raise exception 'CONFIRMACION_INCORRECTA' using errcode = 'P0001';
  end if;

  -- Cuentas del equipo, sin admins (ni quien está borrando).
  select coalesce(array_agg(pe.id), '{}') into v_cuentas
  from public.perfiles pe
  where pe.negocio_id = p_negocio_id
    and pe.id <> v_admin
    and not exists (select 1 from plataforma.administradores a where a.usuario_id = pe.id);

  select jsonb_build_object(
    'nombre', v_neg.nombre,
    'slug', v_neg.slug,
    'alta', v_neg.created_at,
    'estado', plataforma.estado_suscripcion(v_neg.prueba_hasta, v_neg.pagado_hasta, v_neg.suspendido_at),
    'borro_negocio', coalesce(p_borrar_negocio, false),
    'borro_cuentas', coalesce(p_borrar_cuentas, false),
    'dueno', (
      select jsonb_build_object('nombre', pe.nombre, 'email', u."email")
      from public.perfiles pe join auth."user" u on u."id" = pe.id
      where pe.negocio_id = p_negocio_id and pe.rol = 'dueno' order by pe.created_at limit 1
    ),
    'cuentas', case when coalesce(p_borrar_cuentas, false) then coalesce((
      select jsonb_agg(u."email" order by u."email") from auth."user" u where u."id" = any (v_cuentas)
    ), '[]'::jsonb) else '[]'::jsonb end,
    'turnos', (select count(*) from public.turnos t where t.negocio_id = p_negocio_id),
    'clientes', (select count(*) from public.clientes c where c.negocio_id = p_negocio_id),
    'pagos', (select count(*) from plataforma.pagos p where p.negocio_id = p_negocio_id and p.anulado_at is null),
    'total_pagado', (select coalesce(sum(p.monto), 0) from plataforma.pagos p where p.negocio_id = p_negocio_id and p.anulado_at is null)
  ) into v_resumen;

  perform plataforma.auditar(
    case when coalesce(p_borrar_negocio, false) then 'eliminar_negocio' else 'eliminar_cuentas' end,
    p_negocio_id, v_resumen);

  if coalesce(p_borrar_cuentas, false) then
    -- Perfiles, sesiones, cuentas y accesos se van en cascada.
    delete from auth."user" where "id" = any (v_cuentas);
  end if;
  if coalesce(p_borrar_negocio, false) then
    delete from public.negocios where id = p_negocio_id;
  end if;
  return v_resumen;
end;
$$;

-- Negocios eliminados (de la auditoría), para que quede el registro en /admin.
create or replace function plataforma.admin_eliminados()
returns table (negocio_id uuid, detalle jsonb, admin text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform plataforma.requerir_admin();
  return query
    select a.negocio_id, a.detalle, (select u."name" from auth."user" u where u."id" = a.admin_id), a.created_at
    from plataforma.auditoria a
    where a.accion = 'eliminar_negocio'
    order by a.created_at desc
    limit 200;
end;
$$;

grant execute on function plataforma.admin_eliminar(uuid, text, boolean, boolean) to agenda2_usuario;
grant execute on function plataforma.admin_eliminados() to agenda2_usuario;

-- Acciones que se hacen desde la app y se registran después: suma el aviso por WhatsApp
-- al dueño (el admin abre el chat con el mensaje armado desde /admin).
create or replace function plataforma.admin_registrar_accion(p_accion text, p_negocio_id uuid, p_detalle jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform plataforma.requerir_admin();
  if p_accion not in ('link_acceso_dueno', 'reenviar_verificacion', 'aviso_whatsapp') then
    raise exception 'ACCION_INVALIDA' using errcode = 'P0001';
  end if;
  perform plataforma.auditar(p_accion, p_negocio_id, p_detalle);
end;
$$;
