-- =============================================================================
-- 0002 · Suscripciones y administración de la plataforma.
--
-- Cada negocio paga un plan mensual. El estado no se guarda: se calcula con tres
-- datos de public.negocios, así nunca queda desactualizado y no hace falta un cron:
--
--   suspendida  el admin lo suspendió (suspendido_at), sin importar las fechas
--   activa      pagado_hasta en el futuro
--   prueba      prueba_hasta en el futuro (7 días desde el alta)
--   gracia      venció hace menos de plataforma.dias_gracia() días: todo funciona, con aviso
--   vencida     pasó la gracia
--
-- Un negocio "habilitado" (activa, prueba o gracia) funciona normal. Si no lo está:
--   * no se crean turnos nuevos (ni reservas online ni desde el panel);
--   * el panel queda en solo lectura (cualquier escritura con app.usuario_id fijado);
--   * siguen andando: el cliente cancelando desde su link, el cron, los avisos y el admin.
-- Lo controla el trigger plataforma.tg_exigir_habilitado en cada tabla del negocio,
-- así vale también para las funciones security definer (crear_reserva, crear_turno_panel...).
--
-- Los dueños no pueden cambiar estas columnas: el panel solo actualiza las columnas
-- de negocios que tienen grant update explícito en la 0001.
--
-- Esquema plataforma: administradores, pagos, notas y auditoría. Ningún rol de la app
-- tiene permisos sobre sus tablas; el admin opera solo con las funciones
-- plataforma.admin_*, que empiezan verificando que app.usuario_id() sea administrador.
-- Los administradores se agregan desde el servidor: npm run admin -- agregar <mail>.
-- =============================================================================

create schema plataforma;
grant usage on schema plataforma to agenda2_usuario, agenda2_servidor;

-- Suscripción en negocios -----------------------------------------------------------
alter table public.negocios
  add column prueba_hasta      timestamptz not null default now() + interval '7 days',
  add column pagado_hasta      timestamptz,
  add column suspendido_at     timestamptz,
  add column suspension_motivo text check (char_length(suspension_motivo) <= 300);

-- Días de gracia después del vencimiento (de la prueba o del último pago).
create or replace function plataforma.dias_gracia()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 5;
$$;

create or replace function plataforma.estado_suscripcion(
  p_prueba_hasta  timestamptz,
  p_pagado_hasta  timestamptz,
  p_suspendido_at timestamptz
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_suspendido_at is not null then 'suspendida'
    when p_pagado_hasta > now() then 'activa'
    when p_prueba_hasta > now() then 'prueba'
    when greatest(p_prueba_hasta, coalesce(p_pagado_hasta, p_prueba_hasta))
         + make_interval(days => plataforma.dias_gracia()) > now() then 'gracia'
    else 'vencida'
  end;
$$;

-- Fecha en que deja de funcionar (fin de la gracia). Null si está suspendido.
create or replace function plataforma.fin_servicio(
  p_prueba_hasta  timestamptz,
  p_pagado_hasta  timestamptz,
  p_suspendido_at timestamptz
)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_suspendido_at is null then
    greatest(p_prueba_hasta, coalesce(p_pagado_hasta, p_prueba_hasta)) + make_interval(days => plataforma.dias_gracia())
  end;
$$;

create or replace function plataforma.negocio_habilitado(p_negocio_id uuid)
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

-- Administradores y registros --------------------------------------------------------
create table plataforma.administradores (
  usuario_id uuid primary key references auth."user" ("id") on delete cascade,
  created_at timestamptz not null default now()
);

create table plataforma.pagos (
  id             uuid primary key default gen_random_uuid(),
  negocio_id     uuid not null references public.negocios (id) on delete cascade,
  monto          numeric(12, 2) not null check (monto > 0 and monto <= 99999999),
  medio          text not null check (medio in ('transferencia', 'efectivo', 'mercadopago', 'otro')),
  meses          integer not null check (meses between 1 and 24),
  periodo_desde  timestamptz not null,
  periodo_hasta  timestamptz not null,
  nota           text check (char_length(nota) <= 300),
  registrado_por uuid references auth."user" ("id") on delete set null,
  anulado_at     timestamptz,
  anulado_motivo text check (char_length(anulado_motivo) <= 300),
  created_at     timestamptz not null default now(),
  check (periodo_desde < periodo_hasta)
);
create index pagos_negocio_idx on plataforma.pagos (negocio_id, created_at desc);

create table plataforma.notas (
  id         uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references public.negocios (id) on delete cascade,
  texto      text not null check (char_length(texto) between 1 and 2000),
  autor_id   uuid references auth."user" ("id") on delete set null,
  created_at timestamptz not null default now()
);
create index notas_negocio_idx on plataforma.notas (negocio_id, created_at desc);

-- Todo lo que hace un admin queda acá. Sin FK a negocios: el registro sobrevive.
create table plataforma.auditoria (
  id         bigint generated always as identity primary key,
  admin_id   uuid references auth."user" ("id") on delete set null,
  accion     text not null check (char_length(accion) between 1 and 60),
  negocio_id uuid,
  detalle    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index auditoria_negocio_idx on plataforma.auditoria (negocio_id, created_at desc);
create index auditoria_fecha_idx on plataforma.auditoria (created_at desc);

alter table plataforma.administradores enable row level security;
alter table plataforma.pagos           enable row level security;
alter table plataforma.notas           enable row level security;
alter table plataforma.auditoria       enable row level security;
-- Sin políticas ni grants: solo las funciones de abajo (security definer).

-- Helpers del admin ------------------------------------------------------------------
create or replace function plataforma.es_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from plataforma.administradores where usuario_id = app.usuario_id());
$$;

create or replace function plataforma.requerir_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not plataforma.es_admin() then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  return app.usuario_id();
end;
$$;

create or replace function plataforma.auditar(p_accion text, p_negocio_id uuid, p_detalle jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into plataforma.auditoria (admin_id, accion, negocio_id, detalle)
  values (app.usuario_id(), p_accion, p_negocio_id, coalesce(p_detalle, '{}'::jsonb));
$$;

-- Bloqueo por suscripción ------------------------------------------------------------
-- tg_argv[0]: columna con el id del negocio ('id' en negocios, 'negocio_id' en el resto).
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
  -- Turno nuevo (online o panel), o cualquier escritura desde el panel.
  if (tg_table_name = 'turnos' and tg_op = 'INSERT') or (v_panel and not plataforma.es_admin()) then
    if not plataforma.negocio_habilitado(v_negocio) then
      raise exception 'NEGOCIO_NO_HABILITADO' using errcode = 'P0001',
        hint = 'La suscripción del negocio venció o está suspendida.';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger negocios_habilitado before update or delete on public.negocios
  for each row execute function plataforma.tg_exigir_habilitado('id');
create trigger profesionales_habilitado before insert or update or delete on public.profesionales
  for each row execute function plataforma.tg_exigir_habilitado('negocio_id');
create trigger servicios_habilitado before insert or update or delete on public.servicios
  for each row execute function plataforma.tg_exigir_habilitado('negocio_id');
create trigger profesional_servicio_habilitado before insert or update or delete on public.profesional_servicio
  for each row execute function plataforma.tg_exigir_habilitado('negocio_id');
create trigger horarios_habilitado before insert or update or delete on public.horarios_profesional
  for each row execute function plataforma.tg_exigir_habilitado('negocio_id');
create trigger bloqueos_habilitado before insert or update or delete on public.bloqueos
  for each row execute function plataforma.tg_exigir_habilitado('negocio_id');
create trigger clientes_habilitado before insert or update or delete on public.clientes
  for each row execute function plataforma.tg_exigir_habilitado('negocio_id');
create trigger turnos_habilitado before insert or update or delete on public.turnos
  for each row execute function plataforma.tg_exigir_habilitado('negocio_id');

-- Portal público: avisa si el negocio toma reservas -------------------------------------
-- Igual que en la 0001, más 'reservas_habilitadas'.
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

-- Panel del dueño: estado de su suscripción ---------------------------------------------
create or replace function public.mi_suscripcion()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'estado', plataforma.estado_suscripcion(n.prueba_hasta, n.pagado_hasta, n.suspendido_at),
    'prueba_hasta', n.prueba_hasta,
    'pagado_hasta', n.pagado_hasta,
    'fin_servicio', plataforma.fin_servicio(n.prueba_hasta, n.pagado_hasta, n.suspendido_at),
    'suspension_motivo', n.suspension_motivo
  )
  from public.negocios n
  where n.id = public.mi_negocio_id();
$$;

-- =============================================================================
-- Funciones del admin (todas empiezan con plataforma.requerir_admin()).
-- Muestran datos generales del negocio y de su equipo; nunca clientes, turnos
-- uno por uno, precios ni facturación del negocio.
-- =============================================================================

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
      (select max(s."updatedAt") from auth."session" s
        join public.perfiles pe on pe.id = s."userId" where pe.negocio_id = n.id),
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
          'ultimo_ingreso', (select max(s."updatedAt") from auth."session" s where s."userId" = pe.id)
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

-- Pago de N meses. Arranca cuando termina lo que ya tenía (pago anterior o prueba),
-- así pagar antes de tiempo no hace perder días.
create or replace function plataforma.admin_registrar_pago(
  p_negocio_id uuid,
  p_monto      numeric,
  p_medio      text,
  p_meses      integer default 1,
  p_nota       text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := plataforma.requerir_admin();
  v_neg   public.negocios;
  v_desde timestamptz;
  v_hasta timestamptz;
  v_id    uuid;
begin
  select * into v_neg from public.negocios where id = p_negocio_id for update;
  if not found then
    raise exception 'NO_ENCONTRADO' using errcode = 'P0002';
  end if;

  v_desde := greatest(now(), v_neg.prueba_hasta, coalesce(v_neg.pagado_hasta, now()));
  v_hasta := v_desde + make_interval(months => p_meses);

  insert into plataforma.pagos (negocio_id, monto, medio, meses, periodo_desde, periodo_hasta, nota, registrado_por)
  values (p_negocio_id, p_monto, p_medio, p_meses, v_desde, v_hasta, nullif(trim(p_nota), ''), v_admin)
  returning id into v_id;

  update public.negocios set pagado_hasta = v_hasta where id = p_negocio_id;

  perform plataforma.auditar('registrar_pago', p_negocio_id, jsonb_build_object(
    'pago_id', v_id, 'monto', p_monto, 'medio', p_medio, 'meses', p_meses, 'hasta', v_hasta));
  return v_id;
end;
$$;

-- Anular un pago cargado por error: pagado_hasta vuelve al último pago vigente.
create or replace function plataforma.admin_anular_pago(p_pago_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pago plataforma.pagos;
begin
  perform plataforma.requerir_admin();
  if char_length(trim(coalesce(p_motivo, ''))) = 0 then
    raise exception 'FALTA_MOTIVO' using errcode = 'P0001';
  end if;

  update plataforma.pagos set anulado_at = now(), anulado_motivo = trim(p_motivo)
  where id = p_pago_id and anulado_at is null
  returning * into v_pago;
  if not found then
    raise exception 'NO_ENCONTRADO' using errcode = 'P0002';
  end if;

  update public.negocios set pagado_hasta = (
    select max(periodo_hasta) from plataforma.pagos where negocio_id = v_pago.negocio_id and anulado_at is null
  ) where id = v_pago.negocio_id;

  perform plataforma.auditar('anular_pago', v_pago.negocio_id, jsonb_build_object(
    'pago_id', v_pago.id, 'monto', v_pago.monto, 'motivo', trim(p_motivo)));
end;
$$;

-- Suma días a la prueba (desde hoy si ya terminó).
create or replace function plataforma.admin_extender_prueba(p_negocio_id uuid, p_dias integer)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hasta timestamptz;
begin
  perform plataforma.requerir_admin();
  if p_dias is null or p_dias not between 1 and 90 then
    raise exception 'DIAS_INVALIDOS' using errcode = 'P0001';
  end if;
  update public.negocios set prueba_hasta = greatest(prueba_hasta, now()) + make_interval(days => p_dias)
  where id = p_negocio_id
  returning prueba_hasta into v_hasta;
  if not found then
    raise exception 'NO_ENCONTRADO' using errcode = 'P0002';
  end if;
  perform plataforma.auditar('extender_prueba', p_negocio_id, jsonb_build_object('dias', p_dias, 'hasta', v_hasta));
  return v_hasta;
end;
$$;

create or replace function plataforma.admin_suspender(p_negocio_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform plataforma.requerir_admin();
  update public.negocios
  set suspendido_at = coalesce(suspendido_at, now()), suspension_motivo = nullif(trim(p_motivo), '')
  where id = p_negocio_id;
  if not found then
    raise exception 'NO_ENCONTRADO' using errcode = 'P0002';
  end if;
  perform plataforma.auditar('suspender', p_negocio_id, jsonb_build_object('motivo', nullif(trim(p_motivo), '')));
end;
$$;

create or replace function plataforma.admin_reactivar(p_negocio_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform plataforma.requerir_admin();
  update public.negocios set suspendido_at = null, suspension_motivo = null where id = p_negocio_id;
  if not found then
    raise exception 'NO_ENCONTRADO' using errcode = 'P0002';
  end if;
  perform plataforma.auditar('reactivar', p_negocio_id);
end;
$$;

create or replace function plataforma.admin_agregar_nota(p_negocio_id uuid, p_texto text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := plataforma.requerir_admin();
  v_id    uuid;
begin
  insert into plataforma.notas (negocio_id, texto, autor_id) values (p_negocio_id, trim(p_texto), v_admin)
  returning id into v_id;
  perform plataforma.auditar('agregar_nota', p_negocio_id);
  return v_id;
end;
$$;

create or replace function plataforma.admin_cambiar_slug(p_negocio_id uuid, p_slug text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_anterior text;
begin
  perform plataforma.requerir_admin();
  select slug into v_anterior from public.negocios where id = p_negocio_id;
  if not found then
    raise exception 'NO_ENCONTRADO' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.negocios where slug = lower(trim(p_slug)) and id <> p_negocio_id) then
    raise exception 'SLUG_OCUPADO' using errcode = 'P0001';
  end if;
  update public.negocios set slug = lower(trim(p_slug)) where id = p_negocio_id;
  perform plataforma.auditar('cambiar_slug', p_negocio_id,
    jsonb_build_object('antes', v_anterior, 'despues', lower(trim(p_slug))));
end;
$$;

-- Para acciones que se hacen desde la app (link de acceso al dueño, reenviar la
-- verificación): la app las registra con esto después de hacerlas.
create or replace function plataforma.admin_registrar_accion(p_accion text, p_negocio_id uuid, p_detalle jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform plataforma.requerir_admin();
  if p_accion not in ('link_acceso_dueno', 'reenviar_verificacion') then
    raise exception 'ACCION_INVALIDA' using errcode = 'P0001';
  end if;
  perform plataforma.auditar(p_accion, p_negocio_id, p_detalle);
end;
$$;

-- Negocios que vencen pronto o acaban de vencer (avisos del cron). ---------------------
-- Devuelve el dueño de cada negocio cuyo fin de prueba / pago cae en la ventana.
create or replace function plataforma.negocios_por_vencer(p_desde timestamptz, p_hasta timestamptz)
returns table (negocio_id uuid, nombre text, estado text, vence timestamptz, dueno_nombre text, dueno_email text)
language sql
stable
security definer
set search_path = ''
as $$
  select n.id, n.nombre, plataforma.estado_suscripcion(n.prueba_hasta, n.pagado_hasta, n.suspendido_at),
         greatest(n.prueba_hasta, coalesce(n.pagado_hasta, n.prueba_hasta)), pe.nombre, u."email"
  from public.negocios n
  join public.perfiles pe on pe.negocio_id = n.id and pe.rol = 'dueno'
  join auth."user" u on u."id" = pe.id
  where n.suspendido_at is null
    and greatest(n.prueba_hasta, coalesce(n.pagado_hasta, n.prueba_hasta)) >= p_desde
    and greatest(n.prueba_hasta, coalesce(n.pagado_hasta, n.prueba_hasta)) < p_hasta;
$$;

-- Permisos de ejecución ---------------------------------------------------------------
grant execute on function plataforma.estado_suscripcion(timestamptz, timestamptz, timestamptz)
  to agenda2_usuario, agenda2_servidor;
grant execute on function plataforma.fin_servicio(timestamptz, timestamptz, timestamptz)
  to agenda2_usuario, agenda2_servidor;
grant execute on function plataforma.negocio_habilitado(uuid) to agenda2_usuario, agenda2_servidor;
grant execute on function plataforma.es_admin() to agenda2_usuario;
grant execute on function public.mi_suscripcion() to agenda2_usuario;

grant execute on function plataforma.admin_negocios() to agenda2_usuario;
grant execute on function plataforma.admin_negocio(uuid) to agenda2_usuario;
grant execute on function plataforma.admin_registrar_pago(uuid, numeric, text, integer, text) to agenda2_usuario;
grant execute on function plataforma.admin_anular_pago(uuid, text) to agenda2_usuario;
grant execute on function plataforma.admin_extender_prueba(uuid, integer) to agenda2_usuario;
grant execute on function plataforma.admin_suspender(uuid, text) to agenda2_usuario;
grant execute on function plataforma.admin_reactivar(uuid) to agenda2_usuario;
grant execute on function plataforma.admin_agregar_nota(uuid, text) to agenda2_usuario;
grant execute on function plataforma.admin_cambiar_slug(uuid, text) to agenda2_usuario;
grant execute on function plataforma.admin_registrar_accion(text, uuid, jsonb) to agenda2_usuario;

grant execute on function plataforma.negocios_por_vencer(timestamptz, timestamptz) to agenda2_servidor;
