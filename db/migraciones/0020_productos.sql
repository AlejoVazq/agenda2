-- =============================================================================
-- 0020 · Productos, fotos, configuración de la tienda y seña apagada.
--
-- productos: catálogo de cada negocio (ABM solo del dueño; los miembros lo leen).
-- producto_fotos: la imagen (bytea, PNG/JPEG/WebP, máx. 512 KB) como negocio_logos:
--   solo el servidor la lee y la escribe.
-- negocios.tienda_*, transferencia_*, efectivo_plazo_dias: configuración de la tienda
--   (la política de update de negocios ya exige es_dueno).
-- monto_sena: devuelve 0 siempre (seña apagada el 2026-11-24).
-- El stock lo descuenta el servidor al crear un pedido (0021): por eso el rol del
-- servidor puede actualizar productos.stock.
-- =============================================================================

create table public.productos (
  id          uuid primary key default gen_random_uuid(),
  negocio_id  uuid not null references public.negocios (id) on delete cascade,
  nombre      text not null check (char_length(nombre) between 2 and 80),
  descripcion text check (char_length(descripcion) <= 500),
  precio      numeric(12, 2) not null check (precio > 0 and precio <= 99999999),
  stock       integer not null default 0 check (stock >= 0 and stock <= 100000),
  activo      boolean not null default true,
  orden       integer not null default 0,
  created_at  timestamptz not null default now()
);

create index productos_negocio_idx on public.productos (negocio_id, activo, orden);

alter table public.productos enable row level security;

create policy productos_select on public.productos
  for select to agenda2_usuario using (negocio_id = public.mi_negocio_id());
create policy productos_insert on public.productos
  for insert to agenda2_usuario with check (public.es_dueno(negocio_id));
create policy productos_update on public.productos
  for update to agenda2_usuario using (public.es_dueno(negocio_id)) with check (public.es_dueno(negocio_id));
create policy productos_delete on public.productos
  for delete to agenda2_usuario using (public.es_dueno(negocio_id));

revoke all on public.productos from public, agenda2_usuario, agenda2_anonimo, agenda2_servidor;
grant select, insert, delete on public.productos to agenda2_usuario;
grant update (nombre, descripcion, precio, stock, activo, orden) on public.productos to agenda2_usuario;
grant select on public.productos to agenda2_servidor;
grant update (stock) on public.productos to agenda2_servidor;

-- Bloqueo por suscripción: solo frena escrituras del panel (app.usuario_id cargado), así
-- los cambios de stock del servidor al crear un pedido pasan.
create trigger productos_habilitado before insert or update or delete on public.productos
  for each row execute function plataforma.tg_exigir_habilitado('negocio_id');

-- Fotos ------------------------------------------------------------------------------
create table public.producto_fotos (
  producto_id    uuid primary key references public.productos (id) on delete cascade,
  tipo           text not null check (tipo in ('image/png', 'image/jpeg', 'image/webp')),
  datos          bytea not null check (octet_length(datos) between 1 and 524288),
  actualizado_at timestamptz not null default now()
);
alter table public.producto_fotos enable row level security;

revoke all on public.producto_fotos from public, agenda2_usuario, agenda2_anonimo;
grant select, insert, update, delete on public.producto_fotos to agenda2_servidor;

-- Configuración de la tienda ----------------------------------------------------------
alter table public.negocios
  add column tienda_activa boolean not null default false,
  add column tienda_medios text[] not null default '{efectivo}'
    check (tienda_medios <@ array['mercadopago', 'transferencia', 'efectivo'] and cardinality(tienda_medios) >= 1),
  add column transferencia_alias text check (transferencia_alias ~ '^[A-Za-z0-9.-]{6,20}$'),
  add column transferencia_cbu text check (transferencia_cbu ~ '^\d{22}$'),
  add column transferencia_titular text check (char_length(transferencia_titular) between 2 and 80),
  add column transferencia_plazo_horas integer not null default 48 check (transferencia_plazo_horas between 1 and 168),
  add column efectivo_plazo_dias integer not null default 3 check (efectivo_plazo_dias between 1 and 14);

grant update (
  tienda_activa, tienda_medios, transferencia_alias, transferencia_cbu,
  transferencia_titular, transferencia_plazo_horas, efectivo_plazo_dias
) on public.negocios to agenda2_usuario;

-- Seña apagada ------------------------------------------------------------------------
create or replace function public.monto_sena(p_negocio public.negocios, p_precio numeric)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  -- Seña apagada (2026-11-24). Para reactivarla, volver a la versión de 0001_inicial.sql.
  select 0::numeric;
$$;
