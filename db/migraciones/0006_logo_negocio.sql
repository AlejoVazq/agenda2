-- =============================================================================
-- 0006 · Logo de cada negocio.
--
-- La imagen se guarda en la base (bytea, PNG/JPEG/WebP, máx. 512 KB; el navegador
-- la achica a 512 px antes de subirla). Solo el rol del servidor la lee y la escribe:
-- el panel la cambia desde una Server Action que primero verifica que sea el dueño,
-- y el portal la sirve en /n/[slug]/logo. Ni el panel (agenda2_usuario) ni el
-- visitante (agenda2_anonimo) tienen permisos sobre la tabla.
-- =============================================================================

create table public.negocio_logos (
  negocio_id     uuid primary key references public.negocios (id) on delete cascade,
  tipo           text not null check (tipo in ('image/png', 'image/jpeg', 'image/webp')),
  datos          bytea not null check (octet_length(datos) between 1 and 524288),
  actualizado_at timestamptz not null default now()
);
alter table public.negocio_logos enable row level security;

revoke all on public.negocio_logos from public, agenda2_usuario, agenda2_anonimo;
grant select, insert, update, delete on public.negocio_logos to agenda2_servidor;

-- Sin trigger de suscripción: plataforma.tg_exigir_habilitado solo frena escrituras del
-- panel (app.usuario_id). La acción que sube el logo chequea `sesion.habilitado`, como
-- las demás que escriben con el rol del servidor.
