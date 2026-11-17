-- =============================================================================
-- 0011 · Portada y color de la página de reservas de cada negocio.
--
-- color: el principal de la página (#rrggbb en minúsculas). Null = el verde de la marca.
-- La app solo acepta colores con buen contraste contra texto blanco (src/lib/apariencia.ts).
--
-- La portada va como el logo (0006): bytea en una tabla que solo el rol del servidor
-- lee y escribe; el navegador la achica a 1600 px antes de subirla y se sirve en
-- /n/[slug]/portada. Máx. 900 KB (las Server Actions aceptan hasta 1 MB por pedido).
-- =============================================================================

alter table public.negocios
  add column color text check (color ~ '^#[0-9a-f]{6}$');

-- El dueño lo cambia desde el panel (RLS y el trigger de la suscripción como el resto).
grant update (color) on public.negocios to agenda2_usuario;

create table public.negocio_portadas (
  negocio_id     uuid primary key references public.negocios (id) on delete cascade,
  tipo           text not null check (tipo in ('image/png', 'image/jpeg', 'image/webp')),
  datos          bytea not null check (octet_length(datos) between 1 and 921600),
  actualizado_at timestamptz not null default now()
);
alter table public.negocio_portadas enable row level security;

revoke all on public.negocio_portadas from public, agenda2_usuario, agenda2_anonimo;
grant select, insert, update, delete on public.negocio_portadas to agenda2_servidor;
