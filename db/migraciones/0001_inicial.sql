-- =============================================================================
-- 0001 · Esquema inicial de Agenda2 (consolida las migraciones de la época de
-- Supabase, sin datos en producción todavía).
--
-- Corre como agenda2_dueno (ver db/roles.sql), dentro de una transacción.
-- Todas las fechas/horas absolutas son timestamptz (UTC); los horarios
-- semanales, hora local del negocio (time).
--
-- Esquemas:
--   app    Helpers de sesión (app.usuario_id) y la tabla schema_version.
--   auth   Tablas de Better Auth. Solo las toca agenda2_auth.
--   public Datos del negocio, protegidos con RLS.
-- =============================================================================

-- Ninguna función nueva queda ejecutable por cualquiera: cada permiso se da a mano.
alter default privileges revoke execute on functions from public;

revoke all on schema public from public;
grant usage on schema public to agenda2_usuario, agenda2_anonimo, agenda2_servidor;

create schema if not exists app;
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

-- =============================================================================
-- Sesión: quién es el usuario de esta transacción
-- =============================================================================
-- La app lo fija con set_config('app.usuario_id', <id>, true) junto con
-- SET LOCAL ROLE agenda2_usuario (src/lib/db). Reemplaza a auth.uid().
create or replace function app.usuario_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('app.usuario_id', true), '')::uuid;
$$;

grant usage on schema app to agenda2_usuario;
grant execute on function app.usuario_id() to agenda2_usuario;

-- =============================================================================
-- Better Auth (esquema auth)
-- Mismo esquema que genera Better Auth 1.7 con ids uuid y rate limit en la base.
-- Si una versión nueva de Better Auth suma columnas, va en una migración nueva.
-- =============================================================================
create schema auth;

create table auth."user" (
  "id"            uuid primary key default gen_random_uuid(),
  "name"          text not null,
  "email"         text not null unique,
  "emailVerified" boolean not null,
  "image"         text,
  "createdAt"     timestamptz not null default current_timestamp,
  "updatedAt"     timestamptz not null default current_timestamp
);

create table auth."session" (
  "id"        uuid primary key default gen_random_uuid(),
  "expiresAt" timestamptz not null,
  "token"     text not null unique,
  "createdAt" timestamptz not null default current_timestamp,
  "updatedAt" timestamptz not null,
  "ipAddress" text,
  "userAgent" text,
  "userId"    uuid not null references auth."user" ("id") on delete cascade
);
create index "session_userId_idx" on auth."session" ("userId");

create table auth."account" (
  "id"                    uuid primary key default gen_random_uuid(),
  "accountId"             text not null,
  "providerId"            text not null,
  "userId"                uuid not null references auth."user" ("id") on delete cascade,
  "accessToken"           text,
  "refreshToken"          text,
  "idToken"               text,
  "accessTokenExpiresAt"  timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  "scope"                 text,
  "password"              text,
  "createdAt"             timestamptz not null default current_timestamp,
  "updatedAt"             timestamptz not null
);
create index "account_userId_idx" on auth."account" ("userId");

create table auth."verification" (
  "id"         uuid primary key default gen_random_uuid(),
  "identifier" text not null,
  "value"      text not null,
  "expiresAt"  timestamptz not null,
  "createdAt"  timestamptz not null default current_timestamp,
  "updatedAt"  timestamptz not null default current_timestamp
);
create index "verification_identifier_idx" on auth."verification" ("identifier");

create table auth."rateLimit" (
  "id"          uuid primary key default gen_random_uuid(),
  "key"         text not null unique,
  "count"       integer not null,
  "lastRequest" bigint not null
);

grant usage on schema auth to agenda2_auth, agenda2_servidor;
grant select, insert, update, delete on all tables in schema auth to agenda2_auth;
-- El servidor necesita el mail de los usuarios (avisos al dueño, accesos del equipo),
-- nunca contraseñas, tokens ni sesiones.
grant select ("id", "name", "email", "emailVerified") on auth."user" to agenda2_servidor;

-- =============================================================================
-- Tipos y utilidades
-- =============================================================================
-- Rango de horas del día, para que las franjas de un profesional no se pisen.
create type public.rango_hora as range (subtype = time);

create type public.rol_usuario as enum ('dueno', 'empleado');
create type public.estado_turno as enum ('pendiente', 'confirmado', 'cancelado', 'completado', 'ausente');

create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Celular en un solo formato. Argentina: 10 dígitos, sin 54, 9, 0 ni 15.
-- Otros países quedan como están. Misma regla que normalizarTelefono (src/lib/whatsapp.ts).
create or replace function public.normalizar_telefono(p_telefono text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  n text := regexp_replace(coalesce(p_telefono, ''), '[^0-9]', '', 'g');
  largo integer;
begin
  if n = '' then
    return null;
  end if;
  if n like '00%' then
    n := substr(n, 3);
  end if;
  if n like '549%' and char_length(n) = 13 then
    return substr(n, 4);
  end if;
  if n like '54%' and char_length(n) = 12 then
    return substr(n, 3);
  end if;
  if n like '54%' and char_length(n) > 12 then
    n := regexp_replace(substr(n, 3), '^9', '');
  end if;
  if n like '0%' then
    n := substr(n, 2);
  end if;
  -- Característica de 2 a 4 dígitos seguida de "15" (forma local de los celulares).
  if char_length(n) = 12 then
    for largo in 2..4 loop
      if substr(n, largo + 1, 2) = '15' then
        n := left(n, largo) || substr(n, largo + 3);
        exit;
      end if;
    end loop;
  end if;
  return n;
end;
$$;

-- =============================================================================
-- Tablas
-- =============================================================================

-- Negocios ---------------------------------------------------------------------
create table public.negocios (
  id                      uuid primary key default gen_random_uuid(),
  nombre                  text not null check (char_length(nombre) between 2 and 80),
  slug                    text not null unique
                            check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 50),
  rubro                   text not null default 'otro',
  telefono                text check (char_length(telefono) <= 30),
  direccion               text check (char_length(direccion) <= 160),
  descripcion             text check (char_length(descripcion) <= 500),
  zona_horaria            text not null default 'America/Argentina/Buenos_Aires',
  -- Política de reservas y cancelación
  cancelacion_min_horas   integer not null default 2 check (cancelacion_min_horas between 0 and 168),
  anticipacion_min_min    integer not null default 60 check (anticipacion_min_min between 0 and 10080),
  anticipacion_max_dias   integer not null default 30 check (anticipacion_max_dias between 1 and 365),
  intervalo_min           integer not null default 15 check (intervalo_min in (5, 10, 15, 20, 30, 60)),
  confirmacion_automatica boolean not null default true,
  activo                  boolean not null default true,
  -- Recordatorios: horas antes del turno (0 = no se mandan).
  recordatorio_horas      integer not null default 24 check (recordatorio_horas between 0 and 72),
  -- Seña con Mercado Pago (hoy oculta: SENA_ACTIVA en src/lib/env.ts).
  sena_tipo               text not null default 'ninguna' check (sena_tipo in ('ninguna', 'porcentaje', 'fijo')),
  sena_valor              numeric(12, 2) not null default 0 check (sena_valor >= 0 and sena_valor <= 99999999),
  pago_plazo_min          integer not null default 30 check (pago_plazo_min between 10 and 1440),
  whatsapp_avisos         boolean not null default false,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint negocios_rubro_check
    check (rubro in ('peluqueria_masculina', 'peluqueria_femenina', 'barberia', 'unas', 'estetica', 'spa', 'otro')),
  constraint negocios_sena_porcentaje_check check (sena_tipo <> 'porcentaje' or sena_valor <= 100)
);

create trigger negocios_updated_at before update on public.negocios
  for each row execute function public.tg_set_updated_at();

-- Profesionales ----------------------------------------------------------------
create table public.profesionales (
  id                 uuid primary key default gen_random_uuid(),
  negocio_id         uuid not null references public.negocios (id) on delete cascade,
  nombre             text not null check (char_length(nombre) between 2 and 80),
  email              text check (char_length(email) <= 254),
  color              text not null default '#7c3aed' check (color ~ '^#[0-9a-fA-F]{6}$'),
  activo             boolean not null default true,
  orden              integer not null default 0,
  google_calendar_id text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (negocio_id, id)
);

create index profesionales_negocio_idx on public.profesionales (negocio_id);
create trigger profesionales_updated_at before update on public.profesionales
  for each row execute function public.tg_set_updated_at();

-- Perfiles (usuarios del panel) ---------------------------------------------------
-- Un usuario pertenece a un solo negocio. Los clientes que reservan NO tienen perfil.
create table public.perfiles (
  id             uuid primary key references auth."user" ("id") on delete cascade,
  negocio_id     uuid not null references public.negocios (id) on delete cascade,
  rol            public.rol_usuario not null,
  nombre         text not null check (char_length(nombre) between 2 and 80),
  -- Empleado (o dueño que atiende): el profesional cuya agenda le pertenece.
  profesional_id uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  foreign key (negocio_id, profesional_id)
    references public.profesionales (negocio_id, id) on delete set null (profesional_id),
  unique (profesional_id)
);

create index perfiles_negocio_idx on public.perfiles (negocio_id);
create trigger perfiles_updated_at before update on public.perfiles
  for each row execute function public.tg_set_updated_at();

-- Accesos del equipo -------------------------------------------------------------
-- Links de un solo uso que el dueño comparte a mano (WhatsApp, etc.) para que un
-- empleado elija su contraseña: la primera vez (invitación) o si la olvidó
-- (recuperación). Se guarda el hash SHA-256 del token, nunca el token.
create table public.accesos (
  id         uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth."user" ("id") on delete cascade,
  tipo       text not null check (tipo in ('invitacion', 'recuperacion')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expira_at  timestamptz not null,
  usado_at   timestamptz,
  created_at timestamptz not null default now()
);

create index accesos_usuario_idx on public.accesos (usuario_id);

-- Servicios --------------------------------------------------------------------
create table public.servicios (
  id           uuid primary key default gen_random_uuid(),
  negocio_id   uuid not null references public.negocios (id) on delete cascade,
  nombre       text not null check (char_length(nombre) between 2 and 80),
  descripcion  text check (char_length(descripcion) <= 300),
  duracion_min integer not null check (duracion_min between 5 and 600),
  precio       numeric(12, 2) check (precio >= 0),
  activo       boolean not null default true,
  orden        integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (negocio_id, id)
);

create index servicios_negocio_idx on public.servicios (negocio_id);
create trigger servicios_updated_at before update on public.servicios
  for each row execute function public.tg_set_updated_at();

-- Qué servicios realiza cada profesional ---------------------------------------
create table public.profesional_servicio (
  negocio_id     uuid not null,
  profesional_id uuid not null,
  servicio_id    uuid not null,
  primary key (profesional_id, servicio_id),
  foreign key (negocio_id, profesional_id) references public.profesionales (negocio_id, id) on delete cascade,
  foreign key (negocio_id, servicio_id) references public.servicios (negocio_id, id) on delete cascade
);

create index profesional_servicio_servicio_idx on public.profesional_servicio (servicio_id);
create index profesional_servicio_negocio_idx on public.profesional_servicio (negocio_id);

-- Horario semanal de cada profesional (hora local del negocio) -----------------
-- dia_semana: 0 = domingo ... 6 = sábado (igual que extract(dow)).
create table public.horarios_profesional (
  id             uuid primary key default gen_random_uuid(),
  negocio_id     uuid not null,
  profesional_id uuid not null,
  dia_semana     smallint not null check (dia_semana between 0 and 6),
  desde          time not null,
  hasta          time not null,
  check (desde < hasta),
  foreign key (negocio_id, profesional_id) references public.profesionales (negocio_id, id) on delete cascade,
  -- Las franjas de un mismo profesional y día no pueden superponerse.
  exclude using gist (
    profesional_id with =,
    dia_semana with =,
    public.rango_hora(desde, hasta, '[)') with &&
  )
);

create index horarios_profesional_negocio_idx on public.horarios_profesional (negocio_id);

-- Bloqueos puntuales (vacaciones, trámites, ocupados de Google) ------------------
create table public.bloqueos (
  id             uuid primary key default gen_random_uuid(),
  negocio_id     uuid not null,
  profesional_id uuid not null,
  inicio         timestamptz not null,
  fin            timestamptz not null,
  motivo         text check (char_length(motivo) <= 120),
  origen         text not null default 'manual' check (origen in ('manual', 'google')),
  created_at     timestamptz not null default now(),
  check (inicio < fin),
  foreign key (negocio_id, profesional_id) references public.profesionales (negocio_id, id) on delete cascade
);

create index bloqueos_profesional_rango_idx on public.bloqueos using gist (profesional_id, tstzrange(inicio, fin, '[)'));
create index bloqueos_negocio_idx on public.bloqueos (negocio_id);
create index bloqueos_google_idx on public.bloqueos (profesional_id, inicio) where origen = 'google';

-- Clientes del negocio (sin cuenta) --------------------------------------------
create table public.clientes (
  id                      uuid primary key default gen_random_uuid(),
  negocio_id              uuid not null references public.negocios (id) on delete cascade,
  nombre                  text not null check (char_length(nombre) between 2 and 80),
  -- Solo dígitos, normalizado con normalizar_telefono.
  telefono                text not null check (telefono ~ '^[0-9]{8,15}$'),
  email                   text check (char_length(email) <= 254),
  notas                   text check (char_length(notas) <= 500),
  -- Las inasistencias anteriores a esta fecha no limitan al cliente ("Quitar límite").
  ausencias_perdonadas_at timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (negocio_id, telefono),
  unique (negocio_id, id)
);

create trigger clientes_updated_at before update on public.clientes
  for each row execute function public.tg_set_updated_at();

-- Turnos -----------------------------------------------------------------------
create table public.turnos (
  id                         uuid primary key default gen_random_uuid(),
  negocio_id                 uuid not null references public.negocios (id) on delete cascade,
  profesional_id             uuid not null,
  servicio_id                uuid not null,
  cliente_id                 uuid not null,
  inicio                     timestamptz not null,
  fin                        timestamptz not null,
  estado                     public.estado_turno not null default 'confirmado',
  -- Token secreto para ver/cancelar sin login (2 UUID v4 = ~244 bits aleatorios).
  token_cancelacion          text not null unique
                               default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  precio                     numeric(12, 2),
  notas                      text check (char_length(notas) <= 500),
  origen                     text not null default 'online' check (origen in ('online', 'panel')),
  cancelado_at               timestamptz,
  cancelado_por              text,
  -- Con qué datos se pidió el turno. La ficha del cliente no alcanza: quien reserva
  -- con un celular ya registrado no es necesariamente el dueño de esa ficha, y un
  -- empleado ve solo estos datos, nunca la ficha (ver la política clientes_select).
  nombre_reserva             text,
  email_reserva              text,
  telefono_reserva           text,
  -- Recordatorios
  recordatorio_enviado_at    timestamptz,
  recordatorio_wa_enviado_at timestamptz,
  -- Google Calendar
  google_event_id            text,
  google_calendar_prof_id    uuid,
  google_sincronizado_at     timestamptz,
  -- Seña con Mercado Pago.
  -- pendiente: esperando la seña (el horario queda retenido hasta pago_vence_at)
  -- aprobado:  seña cobrada (online o marcada a mano)
  -- vencido:   no se pagó a tiempo y el turno se liberó
  -- reembolsar: se cobró pero el turno ya no existe (devolver la seña)
  -- devuelta:  el negocio registró que devolvió la seña
  pago_estado                text,
  pago_id                    text,
  sena_monto                 numeric(12, 2) check (sena_monto > 0),
  pago_vence_at              timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  check (inicio < fin),
  constraint turnos_cancelado_por_check check (cancelado_por in ('cliente', 'negocio', 'sistema')),
  constraint turnos_pago_estado_check
    check (pago_estado is null or pago_estado in ('pendiente', 'aprobado', 'vencido', 'reembolsar', 'devuelta')),
  constraint turnos_pago_pendiente_check
    check (pago_estado is distinct from 'pendiente' or pago_vence_at is not null),
  foreign key (negocio_id, profesional_id) references public.profesionales (negocio_id, id),
  foreign key (negocio_id, servicio_id) references public.servicios (negocio_id, id),
  foreign key (negocio_id, cliente_id) references public.clientes (negocio_id, id),
  -- Nunca dos turnos activos superpuestos para el mismo profesional,
  -- aunque dos personas reserven al mismo tiempo.
  constraint turnos_sin_superposicion exclude using gist (
    profesional_id with =,
    tstzrange(inicio, fin, '[)') with &&
  ) where (estado <> 'cancelado')
);

create index turnos_negocio_inicio_idx on public.turnos (negocio_id, inicio);
create index turnos_cliente_idx on public.turnos (cliente_id);
create index turnos_servicio_idx on public.turnos (servicio_id);
create index turnos_pago_pendiente_idx on public.turnos (pago_vence_at) where pago_estado = 'pendiente';
create trigger turnos_updated_at before update on public.turnos
  for each row execute function public.tg_set_updated_at();

-- Un turno futuro no puede figurar como atendido ni como inasistencia, y al
-- cambiarlo de horario el recordatorio se vuelve a mandar.
create or replace function public.validar_estado_turno()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.estado in ('ausente', 'completado') and new.inicio > now() then
    raise exception 'TURNO_FUTURO' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and new.inicio is distinct from old.inicio then
    new.recordatorio_enviado_at := null;
    new.recordatorio_wa_enviado_at := null;
  end if;
  return new;
end;
$$;

create trigger turnos_validar_estado before insert or update on public.turnos
  for each row execute function public.validar_estado_turno();

-- Integraciones (Google Calendar, Mercado Pago, WhatsApp) ------------------------
-- Una fila por negocio y proveedor, o por profesional (Google Calendar).
-- `config` guarda solo datos no secretos (cuenta, opciones).
create table public.integraciones (
  id             uuid primary key default gen_random_uuid(),
  negocio_id     uuid not null references public.negocios (id) on delete cascade,
  profesional_id uuid,
  proveedor      text not null check (proveedor in ('google_calendar', 'mercadopago', 'whatsapp')),
  estado         text not null default 'inactiva' check (estado in ('inactiva', 'activa', 'error')),
  config         jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  foreign key (negocio_id, profesional_id) references public.profesionales (negocio_id, id) on delete cascade,
  constraint integraciones_unica unique nulls not distinct (negocio_id, proveedor, profesional_id)
);

create index integraciones_negocio_idx on public.integraciones (negocio_id);
create trigger integraciones_updated_at before update on public.integraciones
  for each row execute function public.tg_set_updated_at();

-- Secretos de las integraciones: texto cifrado por la app (AES-256-GCM con
-- INTEGRACIONES_CLAVE). Solo los lee el servidor.
create table public.integraciones_secretos (
  integracion_id uuid primary key references public.integraciones (id) on delete cascade,
  datos          text not null,
  updated_at     timestamptz not null default now()
);

create trigger integraciones_secretos_updated_at before update on public.integraciones_secretos
  for each row execute function public.tg_set_updated_at();

-- Límites de uso (anti-abuso del portal público) --------------------------------
create table public.limites_uso (
  clave   text not null,
  ventana timestamptz not null,
  cuenta  integer not null default 0,
  primary key (clave, ventana)
);

-- =============================================================================
-- Seguridad: Row Level Security
--
-- * agenda2_anonimo (portal público): sin acceso a ninguna tabla. Usa solo las
--   funciones security definer de más abajo.
-- * agenda2_usuario: solo datos del negocio al que pertenece su perfil.
--   - dueno: lee y escribe todo su negocio.
--   - empleado: lee la configuración del negocio, pero solo los turnos y
--     bloqueos de su propia agenda. No lee fichas de clientes: de sus turnos
--     ve solo nombre, mail y celular con los que se pidió cada uno.
-- * Un usuario sin perfil (recién registrado) no ve nada.
-- * agenda2_servidor saltea RLS (BYPASSRLS) y tiene permisos explícitos.
-- =============================================================================

-- Helpers (security definer para leer perfiles sin recursión de RLS) -----------
create or replace function public.mi_negocio_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select negocio_id from public.perfiles where id = app.usuario_id();
$$;

create or replace function public.mi_rol()
returns public.rol_usuario
language sql
stable
security definer
set search_path = ''
as $$
  select rol from public.perfiles where id = app.usuario_id();
$$;

create or replace function public.mi_profesional_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select profesional_id from public.perfiles where id = app.usuario_id();
$$;

create or replace function public.es_miembro(p_negocio_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.perfiles where id = app.usuario_id() and negocio_id = p_negocio_id
  );
$$;

create or replace function public.es_dueno(p_negocio_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.perfiles
    where id = app.usuario_id() and negocio_id = p_negocio_id and rol = 'dueno'
  );
$$;

alter table public.negocios               enable row level security;
alter table public.perfiles               enable row level security;
alter table public.accesos                enable row level security;
alter table public.profesionales          enable row level security;
alter table public.servicios              enable row level security;
alter table public.profesional_servicio   enable row level security;
alter table public.horarios_profesional   enable row level security;
alter table public.bloqueos               enable row level security;
alter table public.clientes               enable row level security;
alter table public.turnos                 enable row level security;
alter table public.integraciones          enable row level security;
alter table public.integraciones_secretos enable row level security;
alter table public.limites_uso            enable row level security;

-- Negocios: alta solo con crear_negocio(); nunca se borran desde el panel.
create policy negocios_select on public.negocios
  for select to agenda2_usuario using (public.es_miembro(id));
create policy negocios_update on public.negocios
  for update to agenda2_usuario using (public.es_dueno(id)) with check (public.es_dueno(id));

-- Perfiles: cada uno ve el suyo; el dueño ve a su equipo.
-- Altas y bajas las hace el servidor (accesos del equipo) o crear_negocio().
create policy perfiles_select on public.perfiles
  for select to agenda2_usuario using (id = app.usuario_id() or public.es_dueno(negocio_id));

-- Configuración del negocio: todos los miembros leen, solo el dueño escribe.
create policy profesionales_select on public.profesionales
  for select to agenda2_usuario using (public.es_miembro(negocio_id));
create policy profesionales_insert on public.profesionales
  for insert to agenda2_usuario with check (public.es_dueno(negocio_id));
create policy profesionales_update on public.profesionales
  for update to agenda2_usuario using (public.es_dueno(negocio_id)) with check (public.es_dueno(negocio_id));
create policy profesionales_delete on public.profesionales
  for delete to agenda2_usuario using (public.es_dueno(negocio_id));

create policy servicios_select on public.servicios
  for select to agenda2_usuario using (public.es_miembro(negocio_id));
create policy servicios_insert on public.servicios
  for insert to agenda2_usuario with check (public.es_dueno(negocio_id));
create policy servicios_update on public.servicios
  for update to agenda2_usuario using (public.es_dueno(negocio_id)) with check (public.es_dueno(negocio_id));
create policy servicios_delete on public.servicios
  for delete to agenda2_usuario using (public.es_dueno(negocio_id));

create policy profesional_servicio_select on public.profesional_servicio
  for select to agenda2_usuario using (public.es_miembro(negocio_id));
create policy profesional_servicio_insert on public.profesional_servicio
  for insert to agenda2_usuario with check (public.es_dueno(negocio_id));
create policy profesional_servicio_delete on public.profesional_servicio
  for delete to agenda2_usuario using (public.es_dueno(negocio_id));

create policy horarios_select on public.horarios_profesional
  for select to agenda2_usuario using (public.es_miembro(negocio_id));
create policy horarios_insert on public.horarios_profesional
  for insert to agenda2_usuario with check (public.es_dueno(negocio_id));
create policy horarios_update on public.horarios_profesional
  for update to agenda2_usuario using (public.es_dueno(negocio_id)) with check (public.es_dueno(negocio_id));
create policy horarios_delete on public.horarios_profesional
  for delete to agenda2_usuario using (public.es_dueno(negocio_id));

-- Bloqueos: el dueño gestiona todos; el empleado solo los de su agenda.
create policy bloqueos_select on public.bloqueos
  for select to agenda2_usuario
  using (public.es_dueno(negocio_id) or (public.es_miembro(negocio_id) and profesional_id = public.mi_profesional_id()));
create policy bloqueos_insert on public.bloqueos
  for insert to agenda2_usuario
  with check (public.es_dueno(negocio_id) or (public.es_miembro(negocio_id) and profesional_id = public.mi_profesional_id()));
create policy bloqueos_update on public.bloqueos
  for update to agenda2_usuario
  using (public.es_dueno(negocio_id) or (public.es_miembro(negocio_id) and profesional_id = public.mi_profesional_id()))
  with check (public.es_dueno(negocio_id) or (public.es_miembro(negocio_id) and profesional_id = public.mi_profesional_id()));
create policy bloqueos_delete on public.bloqueos
  for delete to agenda2_usuario
  using (public.es_dueno(negocio_id) or (public.es_miembro(negocio_id) and profesional_id = public.mi_profesional_id()));

-- Turnos: el dueño todo su negocio; el empleado solo su agenda.
-- Las altas pasan por funciones (reserva online / alta desde el panel) que validan disponibilidad.
create policy turnos_select on public.turnos
  for select to agenda2_usuario
  using (public.es_dueno(negocio_id) or (public.es_miembro(negocio_id) and profesional_id = public.mi_profesional_id()));
create policy turnos_update on public.turnos
  for update to agenda2_usuario
  using (public.es_dueno(negocio_id) or (public.es_miembro(negocio_id) and profesional_id = public.mi_profesional_id()))
  with check (public.es_dueno(negocio_id) or (public.es_miembro(negocio_id) and profesional_id = public.mi_profesional_id()));

-- Clientes: solo el dueño. Antes un empleado veía la ficha de cualquier cliente con
-- turnos en su agenda, y como él mismo carga turnos, le bastaba con conocer un
-- celular para leer nombre, mail y notas de esa ficha.
create policy clientes_select on public.clientes
  for select to agenda2_usuario using (public.es_dueno(negocio_id));
create policy clientes_update on public.clientes
  for update to agenda2_usuario using (public.es_dueno(negocio_id)) with check (public.es_dueno(negocio_id));
create policy clientes_delete on public.clientes
  for delete to agenda2_usuario using (public.es_dueno(negocio_id));

-- Integraciones: el dueño las de su negocio; el empleado solo su Google Calendar.
-- Altas, bajas y cambios solo desde el servidor, después de verificar permisos.
create policy integraciones_select on public.integraciones
  for select to agenda2_usuario using (public.es_dueno(negocio_id));
create policy integraciones_select_propia on public.integraciones
  for select to agenda2_usuario
  using (public.es_miembro(negocio_id) and profesional_id is not null and profesional_id = public.mi_profesional_id());

-- accesos, integraciones_secretos y limites_uso: sin políticas, solo el servidor.

-- Permisos de tablas ---------------------------------------------------------------
-- RLS decide qué filas; esto, qué operaciones y qué columnas.
grant select, insert, delete on public.bloqueos, public.clientes, public.horarios_profesional,
  public.negocios, public.profesionales, public.servicios, public.turnos to agenda2_usuario;
grant select, insert, update, delete on public.perfiles, public.profesional_servicio to agenda2_usuario;
grant select on public.integraciones to agenda2_usuario;

-- Columnas que un usuario del panel puede cambiar (ni ids ni vínculos entre negocios).
grant update (
  nombre, slug, rubro, telefono, direccion, descripcion,
  cancelacion_min_horas, anticipacion_min_min, anticipacion_max_dias,
  intervalo_min, confirmacion_automatica, recordatorio_horas,
  sena_tipo, sena_valor, pago_plazo_min, whatsapp_avisos
) on public.negocios to agenda2_usuario;
grant update (nombre, email, color, activo, orden) on public.profesionales to agenda2_usuario;
grant update (nombre, descripcion, duracion_min, precio, activo, orden) on public.servicios to agenda2_usuario;
grant update (dia_semana, desde, hasta) on public.horarios_profesional to agenda2_usuario;
grant update (inicio, fin, motivo) on public.bloqueos to agenda2_usuario;
grant update (nombre, telefono, email, notas, ausencias_perdonadas_at) on public.clientes to agenda2_usuario;
grant update (profesional_id, inicio, fin, estado, notas, cancelado_at, cancelado_por, pago_estado)
  on public.turnos to agenda2_usuario;

grant select, insert, update, delete on all tables in schema public to agenda2_servidor;

-- =============================================================================
-- Funciones del panel
-- =============================================================================

-- Alta de negocio + perfil de dueño en una sola transacción. -------------------
-- Si p_dueno_atiende = true, también crea un profesional con el nombre del dueño
-- y lo vincula a su perfil (caso típico: salón chico donde el dueño atiende).
-- Peluquerías y barberías arrancan con sus servicios típicos, sin precio, y las
-- masculinas con intervalos de 10 minutos para que los servicios cortos no dejen huecos.
create or replace function public.crear_negocio(
  p_nombre        text,
  p_slug          text,
  p_rubro         text,
  p_nombre_dueno  text,
  p_telefono      text default null,
  p_direccion     text default null,
  p_dueno_atiende boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid         uuid := app.usuario_id();
  v_negocio_id  uuid;
  v_prof_id     uuid;
begin
  if v_uid is null then
    raise exception 'NO_AUTENTICADO' using errcode = '28000';
  end if;

  if exists (select 1 from public.perfiles where id = v_uid) then
    raise exception 'YA_TIENE_NEGOCIO' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.negocios where slug = lower(p_slug)) then
    raise exception 'SLUG_OCUPADO' using errcode = 'P0001';
  end if;

  insert into public.negocios (nombre, slug, rubro, telefono, direccion, intervalo_min)
  values (
    trim(p_nombre), lower(trim(p_slug)), p_rubro, nullif(trim(p_telefono), ''), nullif(trim(p_direccion), ''),
    case when p_rubro in ('peluqueria_masculina', 'barberia') then 10 else 15 end
  )
  returning id into v_negocio_id;

  if p_dueno_atiende then
    insert into public.profesionales (negocio_id, nombre)
    values (v_negocio_id, trim(p_nombre_dueno))
    returning id into v_prof_id;
  end if;

  insert into public.perfiles (id, negocio_id, rol, nombre, profesional_id)
  values (v_uid, v_negocio_id, 'dueno', trim(p_nombre_dueno), v_prof_id);

  -- Sin precio: cada negocio pone el suyo.
  insert into public.servicios (negocio_id, nombre, duracion_min, orden)
  select v_negocio_id, s.nombre, s.duracion, s.orden
  from (values
    ('masculino', 'Corte de pelo', 30, 1),
    ('masculino', 'Corte y barba', 45, 2),
    ('masculino', 'Arreglo de barba', 20, 3),
    ('masculino', 'Corte infantil', 30, 4),
    ('femenino', 'Corte', 45, 1),
    ('femenino', 'Lavado y brushing', 45, 2),
    ('femenino', 'Color', 120, 3),
    ('femenino', 'Mechas', 150, 4),
    ('femenino', 'Peinado', 60, 5)
  ) as s(tipo, nombre, duracion, orden)
  where s.tipo = case p_rubro
    when 'peluqueria_masculina' then 'masculino'
    when 'barberia' then 'masculino'
    when 'peluqueria_femenina' then 'femenino'
  end;

  if v_prof_id is not null then
    insert into public.profesional_servicio (negocio_id, profesional_id, servicio_id)
    select v_negocio_id, v_prof_id, s.id from public.servicios s where s.negocio_id = v_negocio_id;
  end if;

  return v_negocio_id;
end;
$$;

-- Reemplaza el horario semanal completo de un profesional (atómico). -----------
-- p_franjas: [{"dia_semana":1,"desde":"09:00","hasta":"13:00"}, ...]
-- security invoker: las políticas RLS siguen aplicando (solo el dueño puede).
create or replace function public.guardar_horarios(p_profesional_id uuid, p_franjas jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_negocio_id uuid;
begin
  select negocio_id into v_negocio_id from public.profesionales where id = p_profesional_id;
  if v_negocio_id is null or not public.es_dueno(v_negocio_id) then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;

  delete from public.horarios_profesional where profesional_id = p_profesional_id;

  insert into public.horarios_profesional (negocio_id, profesional_id, dia_semana, desde, hasta)
  select v_negocio_id, p_profesional_id, (f->>'dia_semana')::smallint, (f->>'desde')::time, (f->>'hasta')::time
  from jsonb_array_elements(coalesce(p_franjas, '[]'::jsonb)) as f;
end;
$$;

-- Reemplaza los servicios que realiza un profesional (atómico). ----------------
create or replace function public.guardar_servicios_profesional(p_profesional_id uuid, p_servicio_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_negocio_id uuid;
begin
  select negocio_id into v_negocio_id from public.profesionales where id = p_profesional_id;
  if v_negocio_id is null or not public.es_dueno(v_negocio_id) then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;

  delete from public.profesional_servicio where profesional_id = p_profesional_id;

  -- La FK compuesta (negocio_id, servicio_id) rechaza servicios de otro negocio.
  insert into public.profesional_servicio (negocio_id, profesional_id, servicio_id)
  select distinct v_negocio_id, p_profesional_id, s
  from unnest(coalesce(p_servicio_ids, '{}'::uuid[])) as s;
end;
$$;

-- Alta manual de un turno desde el panel (dueño, o empleado en su agenda). ------
-- No exige que caiga dentro del horario semanal (el negocio puede hacer
-- excepciones), pero la restricción de exclusión impide superposiciones.
-- Un empleado no lee ni modifica la ficha del cliente: el turno queda con los
-- datos que cargó, aunque el celular ya esté registrado.
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
  v_srv        public.servicios;
  v_tel        text := public.normalizar_telefono(p_cliente_telefono);
  v_nombre     text := trim(coalesce(p_cliente_nombre, ''));
  v_email      text := nullif(lower(trim(coalesce(p_cliente_email, ''))), '');
  v_cliente_id uuid;
  v_fin        timestamptz;
  v_id         uuid;
begin
  select negocio_id into v_negocio_id from public.profesionales where id = p_profesional_id;
  v_es_dueno := v_negocio_id is not null and public.es_dueno(v_negocio_id);
  if v_negocio_id is null
     or not (
       v_es_dueno
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
      'confirmado', v_srv.precio, nullif(trim(coalesce(p_notas, '')), ''), 'panel',
      v_nombre, v_email, v_tel
    )
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'HORARIO_NO_DISPONIBLE' using errcode = 'P0001';
  end;

  return v_id;
end;
$$;

-- Estadísticas del panel (dueño) --------------------------------------------------
-- Resumen de un período [p_desde, p_hasta) para el negocio del usuario actual.
-- Una inasistencia no es un turno atendido ni un ingreso.
create or replace function public.estadisticas_negocio(p_desde timestamptz, p_hasta timestamptz)
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
    )
    select jsonb_build_object(
      'total', (select count(*) from base),
      'activos', (select count(*) from base where estado in ('pendiente', 'confirmado', 'completado')),
      'cancelados', (select count(*) from base where estado = 'cancelado'),
      'cancelados_cliente', (select count(*) from base where estado = 'cancelado' and cancelado_por = 'cliente'),
      'online', (select count(*) from base where origen = 'online' and estado not in ('cancelado', 'ausente')),
      'ingresos', (select coalesce(sum(precio), 0) from base where estado in ('confirmado', 'completado')),
      'senas', (select coalesce(sum(sena_monto), 0) from base where pago_estado = 'aprobado'),
      'clientes_nuevos', (
        select count(*) from public.clientes c
        where c.negocio_id = v_negocio_id and c.created_at >= p_desde and c.created_at < p_hasta
      ),
      'por_servicio', coalesce((
        select jsonb_agg(x order by x.cantidad desc)
        from (
          select s.nombre, count(*) as cantidad, coalesce(sum(b.precio), 0) as ingresos
          from base b join public.servicios s on s.id = b.servicio_id
          where b.estado not in ('cancelado', 'ausente')
          group by s.nombre
        ) x
      ), '[]'::jsonb),
      'por_profesional', coalesce((
        select jsonb_agg(x order by x.cantidad desc)
        from (
          select p.nombre, p.color, count(*) as cantidad, coalesce(sum(b.precio), 0) as ingresos
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

-- =============================================================================
-- Portal público y reservas
--
-- El portal público solo accede a la base a través de estas funciones security
-- definer, que devuelven exclusivamente lo necesario y validan todo su input
-- por sí mismas (no confían en la aplicación).
-- =============================================================================

-- Seña que corresponde a un servicio (0 = no se pide). Solo se pide si el negocio
-- la configuró y tiene Mercado Pago conectado.
create or replace function public.monto_sena(p_negocio public.negocios, p_precio numeric)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not exists (
      select 1 from public.integraciones i
      where i.negocio_id = p_negocio.id and i.proveedor = 'mercadopago' and i.estado = 'activa'
    ) then 0
    when p_negocio.sena_tipo = 'porcentaje' and coalesce(p_precio, 0) > 0
      then round(p_precio * p_negocio.sena_valor / 100, 0)
    when p_negocio.sena_tipo = 'fijo'
      then case when coalesce(p_precio, 0) > 0 then least(p_negocio.sena_valor, p_precio) else p_negocio.sena_valor end
    else 0
  end;
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
    'pago_plazo_min', n.pago_plazo_min,
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

-- Horarios libres de un día (fecha local del negocio). -------------------------
-- Cruza: horario semanal del profesional, duración del servicio, turnos
-- existentes (no cancelados ni con seña vencida), bloqueos y la ventana de
-- anticipación del negocio. p_profesional_id null = "cualquier profesional".
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

-- Libera los turnos cuya seña no se pagó a tiempo. Devuelve cuántos liberó.
create or replace function public.vencer_pagos_pendientes(p_negocio_id uuid default null)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cantidad integer;
begin
  update public.turnos
  set estado = 'cancelado', cancelado_at = now(), cancelado_por = 'sistema', pago_estado = 'vencido'
  where pago_estado = 'pendiente'
    and pago_vence_at < now()
    and estado in ('pendiente', 'confirmado')
    and (p_negocio_id is null or negocio_id = p_negocio_id);
  get diagnostics v_cantidad = row_count;
  return v_cantidad;
end;
$$;

-- Reserva online (sin cuenta). ---------------------------------------------------
-- Solo desde el servidor de la app (agenda2_servidor), para que el límite por IP
-- no se pueda esquivar. Devuelve el id del turno, su token secreto y la seña.
-- Reglas: email obligatorio; un turno por fecha con cada email; hasta 3 turnos
-- futuros por local (por email o celular); con 3 inasistencias sin perdonar,
-- uno solo a la vez. Los cancelados no cuentan.
-- Errores (en el mensaje): DATOS_INVALIDOS, NEGOCIO_NO_DISPONIBLE,
-- HORARIO_NO_DISPONIBLE, LIMITE_TURNOS, LIMITE_DIARIO, LIMITE_AUSENCIAS.
create or replace function public.crear_reserva(
  p_negocio_id     uuid,
  p_servicio_id    uuid,
  p_profesional_id uuid,
  p_inicio         timestamptz,
  p_nombre         text,
  p_telefono       text,
  p_email          text default null
)
returns table (turno_id uuid, token text, sena numeric)
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
  v_sena       numeric;
  v_estado     public.estado_turno;
  v_ausencias  integer;
  v_futuros    integer;
  v_del_dia    integer;
begin
  -- Validación de input (también se valida en la app con zod).
  if char_length(v_nombre) not between 2 and 80
     or v_tel is null or v_tel !~ '^[0-9]{8,15}$'
     or v_email is null or char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
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

  -- Las reservas de un local se atienden de a una: los límites cruzan email y
  -- celular, así que un candado por cada dato dejaría pasar pedidos simultáneos.
  perform pg_advisory_xact_lock(hashtextextended(p_negocio_id::text, 0));

  -- Liberar retenciones de seña vencidas antes de contar y de insertar.
  perform public.vencer_pagos_pendientes(p_negocio_id);

  v_fecha := (p_inicio at time zone v_neg.zona_horaria)::date;

  select
    count(*) filter (where t.estado = 'ausente' and t.inicio > coalesce(c.ausencias_perdonadas_at, '-infinity')),
    count(*) filter (where t.estado in ('pendiente', 'confirmado') and t.inicio > now()),
    -- Solo por email: quienes comparten un celular pueden reservar el mismo día.
    count(*) filter (
      where t.estado <> 'cancelado'
        and (t.inicio at time zone v_neg.zona_horaria)::date = v_fecha
        and coalesce(t.email_reserva, lower(c.email)) = v_email
    )
  into v_ausencias, v_futuros, v_del_dia
  from public.turnos t
  join public.clientes c on c.id = t.cliente_id
  where t.negocio_id = p_negocio_id
    and (c.telefono = v_tel or lower(c.email) = v_email or t.email_reserva = v_email);

  if v_ausencias >= 3 and v_futuros >= 1 then
    raise exception 'LIMITE_AUSENCIAS' using errcode = 'P0001';
  end if;

  if v_futuros >= 3 then
    raise exception 'LIMITE_TURNOS' using errcode = 'P0001';
  end if;

  if v_del_dia >= 1 then
    raise exception 'LIMITE_DIARIO' using errcode = 'P0001';
  end if;

  -- Una ficha existente no se toca: quien reserva es anónimo y no prueba ser su dueño.
  insert into public.clientes (negocio_id, nombre, telefono, email)
  values (p_negocio_id, v_nombre, v_tel, v_email)
  on conflict (negocio_id, telefono)
    do update set telefono = public.clientes.telefono
  returning id into v_cliente_id;

  v_sena := public.monto_sena(v_neg, v_srv.precio);
  -- Con seña, el turno queda pendiente hasta que se pague.
  v_estado := case
    when v_sena = 0 and v_neg.confirmacion_automatica then 'confirmado'
    else 'pendiente'
  end::public.estado_turno;

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
        negocio_id, profesional_id, servicio_id, cliente_id, inicio, fin, estado, precio, origen,
        sena_monto, pago_estado, pago_vence_at, email_reserva, nombre_reserva, telefono_reserva
      ) values (
        p_negocio_id, v_prof.profesional_id, p_servicio_id, v_cliente_id,
        p_inicio, p_inicio + make_interval(mins => v_srv.duracion_min),
        v_estado, v_srv.precio, 'online',
        nullif(v_sena, 0),
        case when v_sena > 0 then 'pendiente' end,
        case when v_sena > 0 then now() + make_interval(mins => v_neg.pago_plazo_min) end,
        v_email, v_nombre, v_tel
      )
      returning id, token_cancelacion into turno_id, token;
      sena := v_sena;
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

-- Ver un turno con su token (página del turno, sin login). -----------------------
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
    'cliente', coalesce(t.nombre_reserva, c.nombre),
    'negocio', jsonb_build_object(
      'nombre', n.nombre, 'slug', n.slug, 'telefono', n.telefono,
      'direccion', n.direccion, 'zona_horaria', n.zona_horaria
    ),
    'cancelacion_min_horas', n.cancelacion_min_horas,
    'cancelable_hasta', t.inicio - make_interval(hours => n.cancelacion_min_horas),
    'cancelado_por', t.cancelado_por,
    'sena_monto', t.sena_monto,
    'pago_estado', case
      when t.pago_estado = 'pendiente' and t.pago_vence_at < now() then 'vencido'
      else t.pago_estado
    end,
    'pago_vence_at', t.pago_vence_at,
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

-- =============================================================================
-- Tareas del servidor (cron, integraciones, límites)
-- =============================================================================

-- Suma un uso a `clave` en la ventana actual y dice si sigue dentro del límite.
create or replace function public.consumir_limite(p_clave text, p_maximo integer, p_ventana_seg integer)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ventana timestamptz := to_timestamp(floor(extract(epoch from now()) / p_ventana_seg) * p_ventana_seg);
  v_cuenta  integer;
begin
  insert into public.limites_uso as l (clave, ventana, cuenta)
  values (p_clave, v_ventana, 1)
  on conflict (clave, ventana) do update set cuenta = l.cuenta + 1
  returning cuenta into v_cuenta;
  return v_cuenta <= p_maximo;
end;
$$;

-- Registra el resultado de un pago verificado contra Mercado Pago.
-- Devuelve: 'confirmado' | 'pendiente' (seña cobrada, falta que el negocio confirme)
-- | 'ya_procesado' | 'rechazado' | 'reembolsar' (cobrado pero sin turno).
create or replace function public.registrar_pago(
  p_turno_id uuid,
  p_pago_id  text,
  p_aprobado boolean,
  p_monto    numeric
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_turno  public.turnos;
  v_estado public.estado_turno;
begin
  select * into v_turno from public.turnos where id = p_turno_id for update;
  if not found then
    return 'rechazado';
  end if;

  if v_turno.pago_estado in ('aprobado', 'reembolsar', 'devuelta') then
    return 'ya_procesado';
  end if;
  if not p_aprobado then
    return 'rechazado';
  end if;

  select case when n.confirmacion_automatica then 'confirmado' else 'pendiente' end::public.estado_turno
  into v_estado
  from public.negocios n where n.id = v_turno.negocio_id;

  if coalesce(p_monto, 0) + 0.01 < coalesce(v_turno.sena_monto, 0) then
    update public.turnos set pago_estado = 'reembolsar', pago_id = p_pago_id where id = p_turno_id;
    return 'reembolsar';
  end if;

  if v_turno.estado in ('pendiente', 'confirmado') then
    update public.turnos
    set pago_estado = 'aprobado', pago_id = p_pago_id, pago_vence_at = null, estado = v_estado
    where id = p_turno_id;
    return v_estado::text;
  end if;

  -- El turno se liberó por falta de pago, pero el pago llegó: si el horario
  -- sigue libre se recupera; si no, queda marcado para devolver la seña.
  if v_turno.estado = 'cancelado' and v_turno.cancelado_por = 'sistema' then
    begin
      update public.turnos
      set pago_estado = 'aprobado', pago_id = p_pago_id, pago_vence_at = null, estado = v_estado,
          cancelado_at = null, cancelado_por = null
      where id = p_turno_id;
      return v_estado::text;
    exception when exclusion_violation then
      null;
    end;
  end if;

  update public.turnos set pago_estado = 'reembolsar', pago_id = p_pago_id where id = p_turno_id;
  return 'reembolsar';
end;
$$;

-- Recordatorios por mail ----------------------------------------------------------
-- Marca atómicamente los turnos a recordar y devuelve sus datos. Corre desde el
-- cron cada hora: "skip locked" evita que dos ejecuciones simultáneas manden el
-- mismo mail. Si el envío falla, el cron vuelve a poner recordatorio_enviado_at
-- en null para reintentar. Se recuerdan turnos activos que empiezan dentro de las
-- próximas `recordatorio_horas` (pero no en menos de 1 hora), que no se reservaron
-- hace instantes y sin seña pendiente. El aviso va a quien pidió el turno.
create or replace function public.reclamar_recordatorios(p_limite integer default 100)
returns table (
  turno_id      uuid,
  token         text,
  inicio        timestamptz,
  fin           timestamptz,
  cliente       text,
  email         text,
  servicio      text,
  profesional   text,
  negocio       text,
  slug          text,
  direccion     text,
  telefono      text,
  zona_horaria  text,
  cancelacion_min_horas integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return query
  with candidatos as (
    select t.id
    from public.turnos t
    join public.negocios n on n.id = t.negocio_id
    join public.clientes c on c.id = t.cliente_id
    where n.recordatorio_horas > 0
      and t.estado in ('pendiente', 'confirmado')
      and t.pago_estado is distinct from 'pendiente'
      and t.recordatorio_enviado_at is null
      and coalesce(t.email_reserva, c.email) is not null
      and t.inicio > now() + interval '1 hour'
      and t.inicio <= now() + make_interval(hours => n.recordatorio_horas)
      and t.created_at < now() - interval '3 hours'
    order by t.inicio
    limit least(greatest(p_limite, 1), 500)
    for update of t skip locked
  ),
  marcados as (
    update public.turnos t
    set recordatorio_enviado_at = now()
    from candidatos
    where t.id = candidatos.id
    returning t.*
  )
  select m.id, m.token_cancelacion, m.inicio, m.fin, coalesce(m.nombre_reserva, c.nombre),
         coalesce(m.email_reserva, c.email), s.nombre, p.nombre,
         n.nombre, n.slug, n.direccion, n.telefono, n.zona_horaria, n.cancelacion_min_horas
  from marcados m
  join public.negocios n on n.id = m.negocio_id
  join public.clientes c on c.id = m.cliente_id
  join public.servicios s on s.id = m.servicio_id
  join public.profesionales p on p.id = m.profesional_id;
end;
$$;

-- Recordatorios por WhatsApp: igual que por mail, para negocios con avisos por
-- WhatsApp activados; usa su propia marca para no pisarse con el mail.
create or replace function public.reclamar_recordatorios_whatsapp(p_limite integer default 100)
returns table (
  turno_id     uuid,
  token        text,
  inicio       timestamptz,
  cliente      text,
  telefono     text,
  servicio     text,
  negocio      text,
  zona_horaria text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return query
  with candidatos as (
    select t.id
    from public.turnos t
    join public.negocios n on n.id = t.negocio_id
    where n.whatsapp_avisos
      and n.recordatorio_horas > 0
      and t.estado in ('pendiente', 'confirmado')
      and t.pago_estado is distinct from 'pendiente'
      and t.recordatorio_wa_enviado_at is null
      and t.inicio > now() + interval '1 hour'
      and t.inicio <= now() + make_interval(hours => n.recordatorio_horas)
      and t.created_at < now() - interval '3 hours'
    order by t.inicio
    limit least(greatest(p_limite, 1), 500)
    for update of t skip locked
  ),
  marcados as (
    update public.turnos t
    set recordatorio_wa_enviado_at = now()
    from candidatos
    where t.id = candidatos.id
    returning t.*
  )
  select m.id, m.token_cancelacion, m.inicio, coalesce(m.nombre_reserva, c.nombre),
         coalesce(m.telefono_reserva, c.telefono), s.nombre, n.nombre, n.zona_horaria
  from marcados m
  join public.negocios n on n.id = m.negocio_id
  join public.clientes c on c.id = m.cliente_id
  join public.servicios s on s.id = m.servicio_id;
end;
$$;

-- Google Calendar: cola de sincronización ----------------------------------------
-- Turnos cuyo último cambio todavía no se reflejó en Google (o que se crearon
-- antes de conectar la cuenta). `version` es su updated_at al leerlos.
create or replace function public.turnos_para_sincronizar(p_limite integer default 50)
returns table (turno_id uuid, version timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.updated_at
  from public.turnos t
  where t.updated_at > coalesce(t.google_sincronizado_at, '-infinity'::timestamptz)
    and t.fin > now() - interval '7 days'
    and (
      t.google_event_id is not null
      or exists (
        select 1 from public.integraciones i
        where i.proveedor = 'google_calendar' and i.estado = 'activa' and i.profesional_id = t.profesional_id
      )
    )
  order by t.inicio
  limit least(greatest(p_limite, 1), 200);
$$;

-- Marca un turno como sincronizado. Si cambió desde que se leyó (otra versión),
-- guarda el evento pero lo deja en la cola para la próxima pasada.
create or replace function public.marcar_sincronizado_google(
  p_turno_id uuid,
  p_version  timestamptz,
  p_event_id text,
  p_prof_id  uuid
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.turnos
  set google_event_id = p_event_id,
      google_calendar_prof_id = p_prof_id,
      google_sincronizado_at = case when updated_at = p_version then now() else google_sincronizado_at end
  where id = p_turno_id;
$$;

-- Reemplaza los horarios ocupados importados de Google de un profesional en
-- [p_desde, p_hasta). p_ocupados: [{"inicio": "...", "fin": "..."}].
create or replace function public.reemplazar_bloqueos_google(
  p_profesional_id uuid,
  p_desde          timestamptz,
  p_hasta          timestamptz,
  p_ocupados       jsonb
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_negocio_id uuid;
  v_cantidad   integer;
begin
  select negocio_id into v_negocio_id from public.profesionales where id = p_profesional_id;
  if v_negocio_id is null then
    return 0;
  end if;

  delete from public.bloqueos
  where profesional_id = p_profesional_id
    and origen = 'google'
    and fin > p_desde
    and inicio < p_hasta;

  insert into public.bloqueos (negocio_id, profesional_id, inicio, fin, motivo, origen)
  select v_negocio_id, p_profesional_id, greatest((o ->> 'inicio')::timestamptz, p_desde),
         least((o ->> 'fin')::timestamptz, p_hasta), 'Ocupado en Google Calendar', 'google'
  from jsonb_array_elements(coalesce(p_ocupados, '[]'::jsonb)) as o
  where (o ->> 'inicio')::timestamptz < (o ->> 'fin')::timestamptz
    and (o ->> 'fin')::timestamptz > p_desde
    and (o ->> 'inicio')::timestamptz < p_hasta;
  get diagnostics v_cantidad = row_count;
  return v_cantidad;
end;
$$;

-- =============================================================================
-- Permisos de ejecución (ninguna función es ejecutable si no figura acá)
-- =============================================================================

-- Portal público.
grant execute on function public.negocio_publico(text) to agenda2_anonimo, agenda2_usuario;
grant execute on function public.horarios_libres(uuid, uuid, date, uuid) to agenda2_anonimo, agenda2_usuario;
grant execute on function public.dias_disponibles(uuid, uuid, date, integer, uuid) to agenda2_anonimo, agenda2_usuario;
grant execute on function public.ver_turno(text) to agenda2_anonimo, agenda2_usuario;
grant execute on function public.cancelar_turno_cliente(text) to agenda2_anonimo, agenda2_usuario;

-- Panel.
grant execute on function public.mi_negocio_id() to agenda2_usuario;
grant execute on function public.mi_rol() to agenda2_usuario;
grant execute on function public.mi_profesional_id() to agenda2_usuario;
grant execute on function public.es_miembro(uuid) to agenda2_usuario;
grant execute on function public.es_dueno(uuid) to agenda2_usuario;
grant execute on function public.crear_negocio(text, text, text, text, text, text, boolean) to agenda2_usuario;
grant execute on function public.guardar_horarios(uuid, jsonb) to agenda2_usuario;
grant execute on function public.guardar_servicios_profesional(uuid, uuid[]) to agenda2_usuario;
grant execute on function public.crear_turno_panel(uuid, uuid, timestamptz, text, text, text, text, timestamptz) to agenda2_usuario;
grant execute on function public.estadisticas_negocio(timestamptz, timestamptz) to agenda2_usuario;

-- Servidor.
grant execute on function public.crear_reserva(uuid, uuid, uuid, timestamptz, text, text, text) to agenda2_servidor;
grant execute on function public.consumir_limite(text, integer, integer) to agenda2_servidor;
grant execute on function public.vencer_pagos_pendientes(uuid) to agenda2_servidor;
grant execute on function public.registrar_pago(uuid, text, boolean, numeric) to agenda2_servidor;
grant execute on function public.reclamar_recordatorios(integer) to agenda2_servidor;
grant execute on function public.reclamar_recordatorios_whatsapp(integer) to agenda2_servidor;
grant execute on function public.turnos_para_sincronizar(integer) to agenda2_servidor;
grant execute on function public.marcar_sincronizado_google(uuid, timestamptz, text, uuid) to agenda2_servidor;
grant execute on function public.reemplazar_bloqueos_google(uuid, timestamptz, timestamptz, jsonb) to agenda2_servidor;
grant execute on function public.normalizar_telefono(text) to agenda2_servidor, agenda2_usuario;
