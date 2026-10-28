-- =============================================================================
-- Esquema base: negocios, equipo, servicios, horarios, clientes y turnos.
-- Todas las fechas/horas absolutas se guardan como timestamptz (UTC).
-- Los horarios semanales se guardan como hora local del negocio (time).
-- =============================================================================

create extension if not exists btree_gist with schema extensions;

-- Rango de horas del día, usado para que las franjas de un profesional no se pisen.
create type public.rango_hora as range (subtype = time);

create type public.rol_usuario as enum ('dueno', 'empleado');
create type public.estado_turno as enum ('pendiente', 'confirmado', 'cancelado', 'completado');

-- updated_at automático --------------------------------------------------------
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

-- Negocios ---------------------------------------------------------------------
create table public.negocios (
  id                      uuid primary key default gen_random_uuid(),
  nombre                  text not null check (char_length(nombre) between 2 and 80),
  slug                    text not null unique
                            check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 50),
  rubro                   text not null default 'otro'
                            check (rubro in ('peluqueria', 'barberia', 'unas', 'estetica', 'spa', 'otro')),
  telefono                text check (char_length(telefono) <= 30),
  direccion               text check (char_length(direccion) <= 160),
  descripcion             text check (char_length(descripcion) <= 500),
  zona_horaria            text not null default 'America/Argentina/Buenos_Aires',
  -- Política de reservas / cancelación
  cancelacion_min_horas   integer not null default 2 check (cancelacion_min_horas between 0 and 168),
  anticipacion_min_min    integer not null default 60 check (anticipacion_min_min between 0 and 10080),
  anticipacion_max_dias   integer not null default 30 check (anticipacion_max_dias between 1 and 365),
  intervalo_min           integer not null default 15 check (intervalo_min in (5, 10, 15, 20, 30, 60)),
  confirmacion_automatica boolean not null default true,
  activo                  boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
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
  -- Fase 5 (Google Calendar): calendario externo del profesional.
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
  id             uuid primary key references auth.users (id) on delete cascade,
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

-- Bloqueos puntuales (vacaciones, trámites, etc.) ------------------------------
create table public.bloqueos (
  id             uuid primary key default gen_random_uuid(),
  negocio_id     uuid not null,
  profesional_id uuid not null,
  inicio         timestamptz not null,
  fin            timestamptz not null,
  motivo         text check (char_length(motivo) <= 120),
  created_at     timestamptz not null default now(),
  check (inicio < fin),
  foreign key (negocio_id, profesional_id) references public.profesionales (negocio_id, id) on delete cascade
);

create index bloqueos_profesional_rango_idx on public.bloqueos using gist (profesional_id, tstzrange(inicio, fin, '[)'));
create index bloqueos_negocio_idx on public.bloqueos (negocio_id);

-- Clientes del negocio (sin cuenta) --------------------------------------------
create table public.clientes (
  id         uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references public.negocios (id) on delete cascade,
  nombre     text not null check (char_length(nombre) between 2 and 80),
  -- Solo dígitos, normalizado por la aplicación / funciones de reserva.
  telefono   text not null check (telefono ~ '^[0-9]{8,15}$'),
  email      text check (char_length(email) <= 254),
  notas      text check (char_length(notas) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (negocio_id, telefono),
  unique (negocio_id, id)
);

create trigger clientes_updated_at before update on public.clientes
  for each row execute function public.tg_set_updated_at();

-- Turnos -----------------------------------------------------------------------
create table public.turnos (
  id                      uuid primary key default gen_random_uuid(),
  negocio_id              uuid not null references public.negocios (id) on delete cascade,
  profesional_id          uuid not null,
  servicio_id             uuid not null,
  cliente_id              uuid not null,
  inicio                  timestamptz not null,
  fin                     timestamptz not null,
  estado                  public.estado_turno not null default 'confirmado',
  -- Token secreto para ver/cancelar sin login (2 UUID v4 = ~244 bits aleatorios).
  token_cancelacion       text not null unique
                            default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  precio                  numeric(12, 2),
  notas                   text check (char_length(notas) <= 500),
  origen                  text not null default 'online' check (origen in ('online', 'panel')),
  cancelado_at            timestamptz,
  cancelado_por           text check (cancelado_por in ('cliente', 'negocio')),
  -- Preparado para fases siguientes (no se usan todavía):
  recordatorio_enviado_at timestamptz,   -- Fase 4: recordatorios por mail
  google_event_id         text,          -- Fase 5: Google Calendar
  pago_estado             text,          -- Fase 6: Mercado Pago
  pago_id                 text,          -- Fase 6: Mercado Pago
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  check (inicio < fin),
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
create trigger turnos_updated_at before update on public.turnos
  for each row execute function public.tg_set_updated_at();

-- Integraciones externas (Fase 5/6: Google Calendar, Mercado Pago, WhatsApp) ---
-- Solo estructura; los secretos se leerán exclusivamente desde el servidor.
create table public.integraciones (
  id             uuid primary key default gen_random_uuid(),
  negocio_id     uuid not null references public.negocios (id) on delete cascade,
  profesional_id uuid,
  proveedor      text not null check (proveedor in ('google_calendar', 'mercadopago', 'whatsapp')),
  estado         text not null default 'inactiva' check (estado in ('inactiva', 'activa', 'error')),
  config         jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  foreign key (negocio_id, profesional_id) references public.profesionales (negocio_id, id) on delete cascade
);

create index integraciones_negocio_idx on public.integraciones (negocio_id);
create trigger integraciones_updated_at before update on public.integraciones
  for each row execute function public.tg_set_updated_at();
