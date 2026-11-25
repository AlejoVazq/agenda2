# Productos y pedidos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tienda de productos en la página de cada negocio, con pago por Mercado Pago, transferencia o efectivo en el local, stock apartado y recomendación después de reservar un turno.

**Architecture:** Dos migraciones nuevas: `0020_productos.sql` (productos, fotos, configuración de la tienda, seña apagada en la base) y `0021_pedidos.sql` (pedidos, items y funciones `security definer` solo del servidor o con chequeo de dueño). La app lee lo público con el rol del servidor (como las reseñas), crea pedidos con `comoServidor` detrás de un límite por IP y generaliza `src/lib/mercadopago.ts` para cobrar pedidos con `external_reference = "pedido:<uuid>"`. Panel nuevo en `/panel/productos` y `/panel/pedidos`; página del pedido en `/p/[token]`.

**Tech Stack:** PostgreSQL 18 (plpgsql), Next.js 16.4 App Router + Server Actions, React 19, zod 4, Tailwind 4, PGlite para `test:db`, Mercado Pago Checkout Pro (REST).

**Spec:** `docs/superpowers/specs/2026-11-24-productos-y-pedidos-design.md`

## Global Constraints

- Todo en español es-AR: código, nombres, textos y commits. Leer `node_modules/next/dist/docs/` antes de tocar APIs de Next.
- Nunca editar una migración aplicada: `0020_productos.sql` y `0021_pedidos.sql` son nuevas. Si en la base local (`.pgdata`) ya se aplicó una versión y se cambia el archivo, hacer `npm run db:reset` local (nunca contra producción).
- Ninguna función nueva ejecutable por `public`: grants explícitos. El anónimo sigue ejecutando **solo** las 5 funciones públicas y ninguna tabla.
- Consultas con la plantilla `` sql`…${valor}…` ``; nunca concatenar.
- Seña de turnos: `public.monto_sena` devuelve 0 siempre; `SENA_ACTIVA = false` sigue igual.
- Plazos: MP 30 min (fijo); transferencia `transferencia_plazo_horas` default 48 (1–168); efectivo `efectivo_plazo_dias` default 3 (1–14), o hasta el fin del día local del turno asociado si es más tarde.
- Límites: máx. 3 pedidos `pendiente` por `public.clave_email` por negocio (`LIMITE_PEDIDOS`); 10 pedidos por hora por IP y negocio (`dentroDelLimite("pedido:<negocio>", 10, 3600)`); cantidad por item 1–20; máx. 20 items distintos.
- Solo dueños (`es_dueno`) gestionan productos y pedidos; empleados no leen pedidos.
- Escrituras del panel solo con negocio habilitado (`sesion.habilitado` / trigger `plataforma.tg_exigir_habilitado`); crear pedidos solo si `plataforma.negocio_toma_reservas`.
- Fotos de producto: PNG/JPEG/WebP, ≤ 512 KB, tipo por bytes (`tipoDeImagen` de `src/lib/logo.ts`), achicadas en el navegador con `achicarImagen`.
- Pago MP: nunca confiar en query ni webhook; siempre `GET /v1/payments/:id` con el token del negocio.
- Antes de cerrar cada tarea con UI: `npm run typecheck` y `npm run lint`. Al final, además `npm run test:db` y `npm run build`.

## Review Focus

- **Última unidad, dos compradores a la vez**: el segundo recibe "Sin stock" y el stock nunca queda negativo (check `stock >= 0` + `update … where stock >= n`). Test en Task 2.
- **Pago de MP que llega después del vencimiento**: si hay stock se vuelve a apartar y queda `pagado`; si no, `reembolsar` y el dueño lo ve. Nunca se pierde un pago. Test en Task 2.
- **Webhook y vuelta del cliente al mismo tiempo**: el segundo recibe `ya_procesado`, no duplica mails ni descuenta stock dos veces. Test en Task 2 (idempotencia de `registrar_pago_pedido`).
- **Conectar Mercado Pago no prende la seña** de un negocio que tenía `sena_tipo = 'porcentaje'` guardado: `crear_reserva` devuelve `sena = 0` y el turno no queda retenido. Test en Task 1.
- **Negocio en gracia, apagado o con la tienda desactivada**: la tienda no se muestra y `crear_pedido` falla con `TIENDA_NO_DISPONIBLE`/`NEGOCIO_NO_DISPONIBLE`; cancelar desde el cliente y el cron siguen funcionando. Test en Task 2.

---

### Task 1: Migración 0020 — productos, fotos, tienda y seña apagada

**Files:**
- Create: `db/migraciones/0020_productos.sql`
- Modify: `scripts/test-db.mjs` (pruebas nuevas al final, antes del resumen)

**Interfaces:**
- Produces (SQL):
  - `public.productos (id uuid pk default gen_random_uuid(), negocio_id uuid not null fk negocios on delete cascade, nombre text check 2–80, descripcion text null check ≤ 500, precio numeric(12,2) not null check > 0 and ≤ 99999999, stock integer not null default 0 check (stock >= 0 and stock <= 100000), activo boolean not null default true, orden integer not null default 0, created_at timestamptz not null default now())`. Índice `(negocio_id, activo, orden)`.
  - RLS `productos`: select para miembros del negocio (`negocio_id = public.mi_negocio_id()`), insert/update/delete solo `public.es_dueno(negocio_id)`. Grants a `agenda2_usuario`: select, insert, update (nombre, descripcion, precio, stock, activo, orden), delete. `agenda2_servidor`: select, update(stock).
  - `public.producto_fotos (producto_id uuid pk fk productos on delete cascade, tipo text check in ('image/png','image/jpeg','image/webp'), datos bytea check octet_length ≤ 524288, actualizado_at timestamptz default now())`: grants solo a `agenda2_servidor` (select, insert, update, delete), RLS activada sin políticas para el usuario (como `negocio_logos` en `0006`).
  - Columnas en `public.negocios`: `tienda_activa boolean not null default false`, `tienda_medios text[] not null default '{efectivo}' check (tienda_medios <@ '{mercadopago,transferencia,efectivo}' and cardinality(tienda_medios) >= 1)`, `transferencia_alias text check ~ '^[A-Za-z0-9.-]{6,20}$'`, `transferencia_cbu text check ~ '^\d{22}$'`, `transferencia_titular text check length 2–80`, `transferencia_plazo_horas integer not null default 48 check between 1 and 168`, `efectivo_plazo_dias integer not null default 3 check between 1 and 14`. `grant update (...)` de todas a `agenda2_usuario` (la política de update de negocios ya exige `es_dueno`).
  - `public.monto_sena(p_negocio, p_precio)` redefinida: `select 0::numeric` con comentario "Seña apagada (2026-11-24). Para reactivarla, volver a la versión de 0001_inicial.sql". Mismas firma, `security definer`, `search_path = ''`.
  - `create trigger productos_habilitado before insert or update or delete on public.productos for each row execute function plataforma.tg_exigir_habilitado('negocio_id');` (como en `0002_suscripciones.sql:211-225`). El trigger solo frena escrituras del panel (`app.usuario_id` cargado), así que los cambios de stock que hace el servidor en `crear_pedido` pasan. `producto_fotos` no lo necesita: la escribe solo el servidor después de chequear `sesion.habilitado`.

- [ ] **Step 1: Escribir las pruebas que fallan en `scripts/test-db.mjs`**

```js
await prueba("seña apagada: con Mercado Pago conectado y seña configurada, la reserva no pide seña", async () => {
  // Como el dueño de la base: configurar seña e integración activa en el negocio de Ana.
  await q("update public.negocios set sena_tipo = 'porcentaje', sena_valor = 50 where id = $1", [negA]);
  await q("insert into public.integraciones (negocio_id, proveedor, estado, config) values ($1, 'mercadopago', 'activa', '{}') on conflict do nothing", [negA]);
  const r = await como("servidor", () => uno("select sena from public.crear_reserva($1, $2, null, $3::timestamptz, 'Sena Cero', '1155559999', 'senacero@test.com')", [negA, servA, /* un horario libre del lunes, como en las pruebas de reserva */ inicioLibre]));
  assert.equal(Number(r.sena), 0);
  // dejar como estaba
  await q("update public.negocios set sena_tipo = 'ninguna', sena_valor = 0 where id = $1", [negA]);
  await q("delete from public.integraciones where negocio_id = $1 and proveedor = 'mercadopago'", [negA]);
});

await prueba("productos: la dueña hace ABM, la empleada solo lee, otro negocio no ve nada, anon nada", async () => {
  const p = await como("ana", () => uno("insert into public.productos (negocio_id, nombre, precio, stock) values ($1, 'Cera mate', 8500, 5) returning id", [negA]));
  await como("ana", () => q("update public.productos set stock = 4 where id = $1", [p.id]));
  assert.equal((await como("eva", () => q("select id from public.productos"))).length, 1);
  await como("eva", () => falla(q("update public.productos set precio = 1 where id = $1", [p.id]).then((r) => { if (!r.length) throw new Error("sin filas"); }), /sin filas|permission denied/, "empleada edita"));
  assert.equal((await como("beto", () => q("select id from public.productos"))).length, 0);
  await como("anon", () => falla(q("select * from public.productos"), /permission denied/, "anon lee productos"));
  await como("ana", () => falla(q("select * from public.producto_fotos"), /permission denied/, "dueña lee fotos directo"));
  await como("ana", () => falla(q("insert into public.productos (negocio_id, nombre, precio, stock) values ($1, 'X', 10, -1)", [negA]), /check/, "stock negativo"));
});

await prueba("tienda: la dueña configura medios y transferencia; valores inválidos se rechazan", async () => {
  await como("ana", () => q("update public.negocios set tienda_activa = true, tienda_medios = '{efectivo,transferencia}', transferencia_alias = 'peluqueria.ana', transferencia_titular = 'Ana Test' where id = $1", [negA]));
  await como("ana", () => falla(q("update public.negocios set tienda_medios = '{bitcoin}' where id = $1", [negA]), /check/, "medio inválido"));
  await como("ana", () => falla(q("update public.negocios set transferencia_cbu = '123' where id = $1", [negA]), /check/, "cbu inválido"));
  await como("eva", () => q("update public.negocios set tienda_activa = false where id = $1", [negA]));
  assert.equal((await uno("select tienda_activa from public.negocios where id = $1", [negA])).tienda_activa, true, "la empleada no cambia la tienda");
});
```

Usar como `inicioLibre` un horario libre del lunes de prueba que no choque con otras pruebas (ver cómo arman `inicio` las pruebas de "reserva:" alrededor de la línea 422).

- [ ] **Step 2: Correr y ver que fallan**

Run: `npm run test:db`
Expected: FAIL en "seña apagada" (`sena` = 50% del precio) o en "productos" (`relation "public.productos" does not exist`).

- [ ] **Step 3: Escribir `db/migraciones/0020_productos.sql`** con lo de Interfaces, encabezado en el mismo estilo que `0019_instagram.sql`.

- [ ] **Step 4: Correr y ver que pasan**

Run: `npm run test:db`
Expected: `80 pruebas OK` (77 + 3), incluida "anon: solo ejecuta las 5 funciones del portal público".

- [ ] **Step 5: Commit**

```bash
git add db/migraciones/0020_productos.sql scripts/test-db.mjs
git commit -m "Productos: tabla, fotos, configuración de la tienda y seña apagada en la base (migración 0020)"
```

---

### Task 2: Migración 0021 — pedidos y sus funciones

**Files:**
- Create: `db/migraciones/0021_pedidos.sql`
- Modify: `scripts/test-db.mjs`

**Interfaces:**
- Consumes: `public.productos`, columnas de tienda de `negocios` (Task 1); `public.clave_email`, `plataforma.negocio_toma_reservas`, `plataforma.negocio_habilitado`, `public.es_dueno`.
- Produces (SQL):
  - `public.pedidos (id uuid pk, negocio_id fk on delete cascade, numero integer not null, token text not null unique check ~ '^[0-9a-f]{64}$', turno_id uuid null fk turnos on delete set null, nombre text, email text not null, telefono text, medio text check in ('mercadopago','transferencia','efectivo'), estado text not null default 'pendiente' check in ('pendiente','pagado','entregado','cancelado','vencido','reembolsar'), total numeric(12,2) not null check > 0, vence_at timestamptz null, pago_id text null, pagado_at, entregado_at, cancelado_at timestamptz null, cancelado_por text null check in ('cliente','negocio','sistema'), created_at timestamptz default now(), unique (negocio_id, numero))`. Check: `estado <> 'pendiente' or vence_at is not null`. Índice parcial `(vence_at) where estado = 'pendiente'`.
  - `public.pedido_items (id uuid pk, pedido_id fk on delete cascade, producto_id uuid null fk productos on delete set null, nombre text not null, precio_unitario numeric(12,2) not null, cantidad integer not null check between 1 and 20)`.
  - RLS: `pedidos` y `pedido_items` select solo `es_dueno(negocio_id)` (items vía su pedido). Sin insert/update/delete para `agenda2_usuario`: todo por funciones. `agenda2_servidor`: select.
  - `public.crear_pedido(p_negocio uuid, p_items jsonb, p_nombre text, p_email text, p_telefono text, p_medio text, p_turno_token text default null) returns table (pedido_id uuid, token text, numero integer, total numeric)` — solo `agenda2_servidor`. `p_items` = `[{"producto_id": uuid, "cantidad": int}]`. Errores: `TIENDA_NO_DISPONIBLE` (tienda apagada, medio no permitido, MP sin integración activa, transferencia sin alias ni CBU), `NEGOCIO_NO_DISPONIBLE` (no toma reservas), `DATOS_INVALIDOS`, `SIN_STOCK`, `LIMITE_PEDIDOS`. `pg_advisory_xact_lock` por negocio; `numero = coalesce(max(numero),0)+1` del negocio; token `encode(gen_random_bytes(32),'hex')`.
  - `public.ver_pedido(p_token text) returns jsonb` — solo servidor: pedido (sin ids internos de pago), items, `negocio` (nombre, slug, telefono, direccion, zona_horaria, transferencia_alias/cbu/titular), `turno` (inicio) si tiene, y `estado` mostrando `vencido` si `pendiente` con `vence_at < now()`.
  - `public.cancelar_pedido_cliente(p_token text) returns boolean` — solo servidor; solo desde `pendiente`; devuelve stock; `cancelado_por = 'cliente'`.
  - `public.registrar_pago_pedido(p_pedido uuid, p_pago_id text, p_aprobado boolean, p_monto numeric) returns text` — solo servidor; devuelve `'confirmado' | 'ya_procesado' | 'rechazado' | 'reembolsar'` (mismos nombres que `ResultadoPago`). Ya `pagado`/`entregado`/`reembolsar` con ese u otro pago → `ya_procesado`. No aprobado → `rechazado` sin cambios. Monto < total − 0.01 → `reembolsar`. Si `vencido`/`cancelado`: reaparta stock si alcanza para todos los items (→ `pagado`, `confirmado`), si no `reembolsar`.
  - Del panel (`agenda2_usuario`, chequean `es_dueno` y `plataforma.negocio_habilitado`, error `SIN_PERMISO`/`NEGOCIO_NO_HABILITADO`): `public.pedido_marcar_pagado(p_pedido uuid)` (pendiente/vencido→pagado; si vencido reaparta stock o `SIN_STOCK`), `public.pedido_marcar_entregado(p_pedido uuid)` (pendiente o pagado → entregado; si era pendiente también fija `pagado_at`), `public.pedido_cancelar(p_pedido uuid)` (pendiente/pagado → cancelado, devuelve stock, `cancelado_por='negocio'`), `public.pedido_marcar_devuelto(p_pedido uuid)` (reembolsar → cancelado, sin tocar stock).
  - `public.liberar_pedidos_vencidos() returns integer` — solo servidor; `pendiente` con `vence_at < now()` → `vencido`, `cancelado_por = 'sistema'`, devuelve stock; devuelve cantidad.
  - Devolver stock = sumar `cantidad` de cada item al producto si `producto_id` no es null.

- [ ] **Step 1: Pruebas que fallan**

```js
await prueba("pedidos: crear aparta stock, valida medios, límites y no vende de más", async () => {
  const prod = await como("ana", () => uno("insert into public.productos (negocio_id, nombre, precio, stock) values ($1, 'Shampoo', 5000, 2) returning id", [negA]));
  const items = JSON.stringify([{ producto_id: prod.id, cantidad: 2 }]);
  const p1 = await como("servidor", () => uno("select * from public.crear_pedido($1, $2::jsonb, 'Juan Pérez', 'juan@test.com', '1155550101', 'efectivo')", [negA, items]));
  assert.equal(Number(p1.total), 10000);
  assert.equal(p1.numero, 1);
  assert.equal((await uno("select stock from public.productos where id = $1", [prod.id])).stock, 0);
  await como("servidor", () => falla(q("select * from public.crear_pedido($1, $2::jsonb, 'Otra', 'otra@test.com', null, 'efectivo')", [negA, JSON.stringify([{ producto_id: prod.id, cantidad: 1 }])]), /SIN_STOCK/, "sin stock"));
  await como("servidor", () => falla(q("select * from public.crear_pedido($1, $2::jsonb, 'Juan', 'juan@test.com', null, 'mercadopago')", [negA, items]), /TIENDA_NO_DISPONIBLE/, "MP no conectado"));
  await como("anon", () => falla(q("select * from public.crear_pedido($1, $2::jsonb, 'X', 'x@test.com', null, 'efectivo')", [negA, items]), /permission denied/, "anon"));
  await como("ana", () => falla(q("select * from public.crear_pedido($1, $2::jsonb, 'X', 'x@test.com', null, 'efectivo')", [negA, items]), /permission denied/, "panel"));
  // vencimiento de efectivo: 3 días
  const v = await uno("select round(extract(epoch from vence_at - created_at) / 86400) as d from public.pedidos where id = $1", [p1.pedido_id]);
  assert.equal(Number(v.d), 3);
  // límite: 3 pendientes por mail (con alias +x cuenta igual)
  await q("update public.productos set stock = 10 where id = $1", [prod.id]);
  const uno1 = JSON.stringify([{ producto_id: prod.id, cantidad: 1 }]);
  for (const mail of ["juan+a@test.com", "juan+b@test.com"]) await como("servidor", () => q("select * from public.crear_pedido($1, $2::jsonb, 'Juan', $3, null, 'efectivo')", [negA, uno1, mail]));
  await como("servidor", () => falla(q("select * from public.crear_pedido($1, $2::jsonb, 'Juan', 'juan@test.com', null, 'efectivo')", [negA, uno1]), /LIMITE_PEDIDOS/, "4to pendiente"));
});

await prueba("pedidos: vencer devuelve stock; pago tardío reaparta o queda a reembolsar; idempotente", async () => {
  // crear un pedido de transferencia, forzar vence_at al pasado, liberar, verificar stock devuelto,
  // registrar_pago_pedido aprobado por el total → 'confirmado' y estado 'pagado' con stock reapartado;
  // segunda llamada con el mismo pago → 'ya_procesado' y stock igual;
  // otro pedido vencido sin stock disponible → 'reembolsar'; monto menor → 'reembolsar'.
});

await prueba("pedidos: panel solo para dueños; cancelar devuelve stock; cliente cancela por token", async () => {
  // eva y beto no ven pedidos (0 filas) y pedido_marcar_pagado falla con SIN_PERMISO;
  // ana marca pagado → entregado; pedido_cancelar de un pagado devuelve stock;
  // cancelar_pedido_cliente(token) de un pendiente → true y stock devuelto; de un entregado → false;
  // ver_pedido(token) muestra 'vencido' para un pendiente con vence_at pasado.
});

await prueba("pedidos: tienda apagada o negocio que no toma reservas no recibe pedidos; con turno, efectivo hasta el día del turno", async () => {
  // tienda_activa = false → TIENDA_NO_DISPONIBLE; negocio con suspendido_at → NEGOCIO_NO_DISPONIBLE;
  // con p_turno_token de un turno del lunes de prueba (más de 3 días adelante) vence_at = fin del día local del turno
  // y turno_id queda cargado; un token de turno de otro negocio se ignora (turno_id null).
});
```

Las tres últimas pruebas se escriben completas con el mismo estilo que la primera; los comentarios dicen exactamente qué afirmar. Sumar `crear_pedido`, `ver_pedido`, `cancelar_pedido_cliente`, `registrar_pago_pedido` y `liberar_pedidos_vencidos` a la prueba "crear_reserva y las tareas del cron: solo el servidor" (línea ~160).

- [ ] **Step 2:** `npm run test:db` → FAIL (`function public.crear_pedido does not exist`).
- [ ] **Step 3:** Escribir `db/migraciones/0021_pedidos.sql`.
- [ ] **Step 4:** `npm run test:db` → `84 pruebas OK`.
- [ ] **Step 5: Commit** `git commit -m "Pedidos: tablas, crear, vencer, pagar, cancelar y acciones del panel (migración 0021)"`

---

### Task 3: Tipos, validaciones y capa de datos de productos y pedidos

**Files:**
- Create: `src/lib/productos.ts`, `src/lib/pedidos.ts`
- Modify: `src/lib/tipos.ts`, `src/lib/validaciones.ts`, `src/lib/errores.ts`, `src/lib/env.ts:11-30`

**Interfaces:**
- Consumes: funciones y tablas de Tasks 1–2; `tipoDeImagen`, `TipoLogo` de `src/lib/logo.ts`.
- Produces:
  - `tipos.ts`: `Producto { id; negocio_id; nombre; descripcion: string|null; precio: number; stock: number; activo: boolean; orden: number }`, `MedioPago = "mercadopago"|"transferencia"|"efectivo"`, `EstadoPedido = "pendiente"|"pagado"|"entregado"|"cancelado"|"vencido"|"reembolsar"`; `Negocio` suma `tienda_activa, tienda_medios: MedioPago[], transferencia_alias, transferencia_cbu, transferencia_titular, transferencia_plazo_horas, efectivo_plazo_dias`.
  - `productos.ts` (server-only, rol servidor): `productosPublicos(negocioId: string): Promise<ProductoPublico[]>` (activos, orden, con `stock` y `foto_v: number|null`), `versionFoto`, `urlFotoProducto(slug, id, v): string|null`, `fotoProductoPorSlug(slug, id)`, `guardarFotoProducto(productoId, tipo, datos)`, `borrarFotoProducto(productoId)`. `PRODUCTO_FOTO_MAX_BYTES = 512 * 1024`, `tiendaPublica(negocioId)` (ver Task 8).
  - `pedidos.ts` (server-only): `type PedidoPublico` (forma de `ver_pedido`), `verPedido(token: string): Promise<PedidoPublico|null>`, `crearPedido(d: DatosPedido): Promise<{ pedido_id; token; numero; total }>` (llama `crear_pedido` con `comoServidor`), `cancelarPedidoCliente(token): Promise<boolean>`, `liberarPedidosVencidos(): Promise<number>`.
  - `validaciones.ts`: `esquemaProducto` (nombre 2–80, descripcion opcional ≤ 500, precio > 0, stock entero 0–100000, activo bool, orden entero), `esquemaTienda` (tienda_activa, tienda_medios array ≥ 1 de MedioPago, alias `^[A-Za-z0-9.-]{6,20}$` opcional, cbu 22 dígitos opcional, titular opcional, plazos con los rangos de Global Constraints; refine: si incluye transferencia, alias o CBU obligatorio), `esquemaPedido` (negocio_id uuid, items array 1–20 de `{producto_id uuid, cantidad 1–20}` recibido como JSON string, nombre/email/telefono como `esquemaReserva`, medio, turno_token opcional `^[0-9a-f]{64}$`).
  - `errores.ts`: `SIN_STOCK: "Uno de los productos se quedó sin stock. Revisá el carrito."`, `LIMITE_PEDIDOS: "Ya tenés 3 pedidos sin pagar en este negocio. Pagá o cancelá alguno para hacer otro."`, `TIENDA_NO_DISPONIBLE: "Este negocio no está vendiendo con ese medio de pago en este momento."`.
  - `env.ts`: `integracionesDisponibles().mercadopago = cifrado` (sin `SENA_ACTIVA`). Comentario de `SENA_ACTIVA`: ahora solo oculta la configuración de la seña.

- [ ] **Step 1:** Implementar los archivos.
- [ ] **Step 2:** `npm run typecheck && npm run lint` → sin errores.
- [ ] **Step 3: Commit** `git commit -m "Productos y pedidos: tipos, validaciones y acceso a datos"`

---

### Task 4: Mercado Pago para pedidos y avisos por mail

**Files:**
- Modify: `src/lib/mercadopago.ts`, `src/lib/eventos.ts`, `src/lib/email/plantillas.ts`, `src/lib/email/notificar.ts`, `src/app/panel/integraciones/page.tsx`, `src/app/panel/integraciones/formularios.tsx`, `src/app/panel/integraciones/acciones.ts:60`

**Interfaces:**
- Consumes: `verPedido`, `registrar_pago_pedido` (Tasks 2–3).
- Produces:
  - `crearPagoPedido(pedidoId: string): Promise<string | null>` — preferencia con un item por línea (`title` = nombre, `unit_price` = precio_unitario, `quantity`), `external_reference: "pedido:<id>"`, `back_urls` → `${siteUrl}/p/<token>`, `notification_url` igual que la seña, `binary_mode: true`, `payment_methods: { excluded_payment_types: [{ id: "ticket" }, { id: "atm" }] }`, `expires: true`, `expiration_date_to: fechaMP(vence_at)`. Null si el pedido no es `pendiente`, no es `mercadopago` o vence en < 1 min.
  - `procesarPago(negocioId, pagoId, esperado?: string)` devuelve `{ resultado: ResultadoPago; tipo: "turno" | "pedido"; id: string } | null`. `external_reference` con prefijo `pedido:` → valida que el pedido sea del negocio y llama `registrar_pago_pedido`; uuid suelto → camino actual de turnos. `esperado` se compara contra el id del turno o del pedido.
  - `procesarPagoYAvisar` en `eventos.ts`: para `tipo: "pedido"` y `resultado === "confirmado"` llama `notificarPagoPedido(id)`; para turno, igual que hoy (ajustar `src/app/t/[token]/page.tsx:40` al nuevo retorno).
  - `eventos.ts`: `trasPedidoNuevo(pedidoId: string)` → `notificarPedidoCliente(pedidoId)` + `notificarPedidoNegocio(pedidoId)` (por `after()`).
  - Plantillas: `emailPedidoCliente(para, d)` (número, items, total, link `/p/<token>`, instrucciones según medio: alias/CBU/titular + "poné Pedido #N en el concepto"; efectivo: "pagás y retirás en el local hasta el …"; MP: "si no terminaste de pagar, entrá al link"), `emailPedidoNegocio(para, d)` ("Nuevo pedido #N", cliente, medio, total, link a `/panel/pedidos/<id>`), `emailPagoPedido(para, d, destino: "cliente" | "negocio")`. Mismos colores y estructura que las plantillas existentes. Los mails al negocio van a todos los dueños (como los de la membresía).
  - Integraciones: la tarjeta de MP se muestra si `integracionesDisponibles().mercadopago` y la explica como "Cobrar productos con Mercado Pago"; la tarjeta de seña sigue detrás de `SENA_ACTIVA`. Mensaje al desconectar: "Mercado Pago se desconectó. La tienda ya no ofrece pagar con Mercado Pago."
- [ ] **Step 1:** Implementar.
- [ ] **Step 2:** `npm run typecheck && npm run lint` → OK.
- [ ] **Step 3: Commit** `git commit -m "Mercado Pago: cobro de pedidos, conexión sin seña y mails de pedidos"`

---

### Task 5: Panel — Productos

**Files:**
- Create: `src/app/panel/productos/page.tsx`, `src/app/panel/productos/nuevo/page.tsx`, `src/app/panel/productos/[id]/page.tsx`, `src/app/panel/productos/[id]/foto.tsx`, `src/app/panel/productos/acciones.ts`, `src/app/panel/productos/formulario.tsx`, `src/app/n/[slug]/productos/[id]/foto/route.ts`
- Modify: `src/app/panel/navegacion.tsx` (ítems `Productos` y `Pedidos`, `soloDueno: true`, después de Servicios; íconos nuevos `bolsa` y `recibo`)

**Interfaces:**
- Consumes: `esquemaProducto`, `guardarFotoProducto`, `borrarFotoProducto`, `tipoDeImagen`, `requerirDueno`, `sesionParaAccion({ soloDueno: true })`, `achicarImagen`.
- Produces: acciones `guardarProducto(id: string | null, prev, formData): Promise<EstadoAccion>`, `borrarProducto(id: string)` (borrado real: los pedidos conservan nombre y precio en `pedido_items` y `producto_id` queda en null), `subirFotoProducto(id, formData)`, `quitarFotoProducto(id)`. Todas: dueño + `sesion.habilitado` (`MENSAJE_SOLO_LECTURA`).
- Ruta de foto: `GET /n/[slug]/productos/[id]/foto` como `src/app/n/[slug]/logo` (cache inmutable con `?v=`), 404 si el producto no es de ese negocio o el negocio no está activo.
- Pantallas como `src/app/panel/servicios` (lista con precio, stock "Disponible: N", insignia "Sin stock" e "Inactivo"; formulario con foto arriba como `profesionales/[id]/foto.tsx`).

- [ ] **Step 1:** Implementar.
- [ ] **Step 2:** `npm run typecheck && npm run lint` → OK. Con `npm run db:local` + `npm run dev`, entrar como `barbero@turnos.test`, crear un producto con foto y stock 3; como empleado no aparece el menú.
- [ ] **Step 3: Commit** `git commit -m "Panel: productos con foto, precio y stock"`

---

### Task 6: Panel — Tienda en Mi negocio

**Files:**
- Modify: `src/app/panel/negocio/page.tsx`, `src/app/panel/negocio/acciones.ts`, crear `src/app/panel/negocio/tienda.tsx`

**Interfaces:**
- Consumes: `esquemaTienda`, `buscarIntegracion(negocioId, "mercadopago")`.
- Produces: acción `guardarTienda(prev, formData): Promise<EstadoAccion>`; tarjeta "Tienda" con: activar tienda, casillas de medios (Mercado Pago deshabilitada con link "Conectalo en Integraciones" si no está activa), alias, CBU, titular, plazo de transferencia (horas) y de efectivo (días). Si se guarda `mercadopago` sin integración activa → error de campo "Primero conectá Mercado Pago en Integraciones."

- [ ] **Step 1:** Implementar.
- [ ] **Step 2:** `npm run typecheck && npm run lint` → OK; en local activar la tienda con efectivo y transferencia.
- [ ] **Step 3: Commit** `git commit -m "Mi negocio: configuración de la tienda (medios, transferencia y plazos)"`

---

### Task 7: Panel — Pedidos

**Files:**
- Create: `src/app/panel/pedidos/page.tsx`, `src/app/panel/pedidos/[id]/page.tsx`, `src/app/panel/pedidos/acciones.ts`
- Modify: `src/app/panel/page.tsx` (aviso "N pedidos pendientes · M por entregar" con link, solo dueños)

**Interfaces:**
- Consumes: RLS de `pedidos`/`pedido_items` con `comoUsuario`; funciones `pedido_marcar_pagado`, `pedido_marcar_entregado`, `pedido_cancelar`, `pedido_marcar_devuelto`.
- Produces: acciones `marcarPedidoPagado(id)`, `marcarPedidoEntregado(id)`, `cancelarPedido(id)`, `marcarPedidoDevuelto(id)` → `EstadoAccion`, con `mensajeDeError`. Lista con pestañas `?ver=pendientes|por-entregar|historial` (pendientes = `pendiente` + `reembolsar`; por entregar = `pagado`; historial = el resto, 50 por página), cada fila: `#N`, cliente, medio, total, estado, vence. Detalle: items, contacto (con botón WhatsApp `wa.me` como en turnos), medio, link al turno si tiene, botones según estado. Cancelar pide confirmación en la UI sin `confirm()` del navegador (patrón de dos pasos que ya use el panel).

- [ ] **Step 1:** Implementar.
- [ ] **Step 2:** `npm run typecheck && npm run lint` → OK.
- [ ] **Step 3: Commit** `git commit -m "Panel: pedidos (pagos, entregas, cancelaciones y devoluciones)"`

---

### Task 8: Tienda pública y página del pedido

**Files:**
- Create: `src/app/n/[slug]/productos/page.tsx`, `src/app/n/[slug]/productos/tienda.tsx` (cliente: carrito, datos, medio), `src/app/n/[slug]/productos/acciones.ts`, `src/app/n/[slug]/productos-destacados.tsx`, `src/app/p/[token]/page.tsx`, `src/app/p/[token]/acciones.ts`, `src/app/p/[token]/cancelar.tsx`, `src/app/p/[token]/pagar.tsx`
- Modify: `src/app/n/[slug]/page.tsx` (sección "Productos" antes de "Opiniones" si `tienda_activa` y hay productos). `negocio_publico` **no** cambia: la tienda se lee con `productosPublicos` y una función `tiendaPublica(negocioId): Promise<{ activa: boolean; medios: MedioPago[] } | null>` en `src/lib/productos.ts` (rol servidor; `medios` sin `mercadopago` si la integración no está activa, sin `transferencia` si no hay alias ni CBU).

**Interfaces:**
- Consumes: `productosPublicos`, `crearPedido`, `crearPagoPedido`, `trasPedidoNuevo`, `verPedido`, `cancelarPedidoCliente`, `procesarPagoYAvisar`, `dentroDelLimite`, `esquemaPedido`.
- Produces:
  - Acción `pedir(prev, formData): Promise<EstadoAccion>`: valida, límite por IP, `crearPedido`, `trasPedidoNuevo` salvo MP (los avisos de MP salen al confirmarse el pago, como la seña; el mail al cliente con el link sí sale siempre), y `redirect` a la URL de MP o a `/p/<token>?nuevo=1`.
  - Carrito: estado en el cliente, guardado en `localStorage` con clave `carrito:<slug>` dentro de try/catch; no deja superar el stock mostrado; si `crear_pedido` responde `SIN_STOCK`, muestra el mensaje y recarga productos.
  - `?turno=<token>` en `/n/[slug]/productos`: si `ver_turno` devuelve un turno activo de ese negocio, precarga nombre/mail/celular y manda `turno_token`; aviso "Lo retirás el día de tu turno".
  - `/p/[token]`: `metadata` con `robots: noindex` y `referrer: no-referrer` (como `/t/[token]`); procesa `payment_id`/`collection_id` de la vuelta con `procesarPagoYAvisar(negocioId, pagoId, pedidoId)`; muestra lo del spec (transferencia con botones "Copiar" para alias/CBU y monto, WhatsApp "Te transferí el pedido #N"; efectivo; MP pendiente con "Pagar con Mercado Pago"; estados finales). Botón "Cancelar pedido" solo en `pendiente`.
  - Estilo: `tema-negocio` y tokens `marca-*` del portal; animaciones existentes (`animate-aparecer`).

- [ ] **Step 1:** Implementar.
- [ ] **Step 2:** `npm run typecheck && npm run lint` → OK. En local: comprar 2 unidades en efectivo y por transferencia, ver el stock bajar en el panel, cancelar desde `/p/<token>` y verlo volver; el mail sale en la consola de `npm run dev`.
- [ ] **Step 3: Commit** `git commit -m "Portal: tienda de productos con carrito y página del pedido"`

---

### Task 9: Recomendación al reservar, cron y documentación

**Files:**
- Modify: `src/app/t/[token]/page.tsx` (bloque de recomendación), crear `src/app/t/[token]/recomendados.tsx`; `src/app/api/cron/route.ts` (paso "Libera pedidos vencidos" con `liberarPedidosVencidos()`, en el comentario de la lista y en la respuesta JSON); `CLAUDE.md`, `README.md`, `.env.example` (comentario de MP), `docs/registro-2026-11-24.md`

**Interfaces:**
- Consumes: `productosPublicos`, tienda activa del negocio, `liberarPedidosVencidos`.
- Produces: en `/t/[token]?nueva=1` con turno activo y tienda activa con productos con stock: "¿Querés sumar algo para retirar en tu turno?" con hasta 4 productos y botón a `/n/<slug>/productos?turno=<token>`. Documentación: sección "Productos y pedidos" en la Arquitectura de `CLAUDE.md` (tablas, funciones, plazos, seña apagada en la base, MP sin seña), README (cómo probar, credenciales `TEST-`), registro de la sesión.

- [ ] **Step 1:** Implementar.
- [ ] **Step 2:** Verificación completa: `npm run test:db` → `84 pruebas OK`; `npm run typecheck`, `npm run lint`, `npm run build` → sin errores. En local: reservar un turno, ver la recomendación, pedir en efectivo y comprobar que `vence_at` es el día del turno; forzar el cron con un pedido vencido (`curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron`) y ver el stock devuelto.
- [ ] **Step 3: Commit** `git commit -m "Recomendación de productos al reservar, cron de pedidos vencidos y documentación"`

---

### Después del plan (no es una tarea de código)

Probar Mercado Pago de punta a punta en producción con credenciales `TEST-` y luego con las del peluquero, verificando el webhook. Antes del deploy: backup de la base (hay un negocio real) y confirmar que `INTEGRACIONES_CLAVE` está en `.env.production.local`.
