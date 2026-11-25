# Productos y pedidos (tienda con Mercado Pago, transferencia y efectivo)

## Para qué

Que el negocio venda productos (cera, shampoo, etc.) desde su página de reservas, con un cobro al estilo Tiendanube: el cliente elige pagar con **Mercado Pago** (link directo), por **transferencia** (link único del pedido con alias/CBU) o **en efectivo en el local** (queda apartado). El stock se controla dentro de la app. Además, al sacar un turno se le recomiendan productos para retirar ese día.

Pedido del usuario (2026-11-24): productos en un apartado propio de la misma página, recomendados después de reservar, gestionados solo por los dueños; la seña de turnos queda guardada, sin usar.

## Objetivos / no objetivos

- Sí: ABM de productos (nombre, descripción, precio, stock, foto, activo, orden) por los dueños.
- Sí: tienda pública en `/n/[slug]` (sección "Productos" + página `/n/[slug]/productos` con carrito), sin cuenta.
- Sí: tres medios de pago, elegibles por el dueño; Mercado Pago solo si está conectado.
- Sí: link único del pedido `/p/[token]` con estado, instrucciones de pago y reintento de pago con MP.
- Sí: stock apartado al crear el pedido y devuelto si se cancela o vence; nunca se vende más de lo que hay.
- Sí: recomendación de productos en la página del turno recién reservado (`/t/[token]?nueva=1`), con los datos del cliente ya cargados y el pedido asociado al turno.
- Sí: panel `/panel/pedidos` para confirmar pagos, marcar entregado y cancelar.
- Sí: mails al cliente y a los dueños.
- Sí: conectar Mercado Pago sin prender la seña de turnos.
- No: envíos (se retira en el local), variantes (talle/color), cupones/descuentos, devoluciones automáticas por API, estadísticas de ventas, productos dentro del flujo de reserva paso a paso.
- Anti-objetivos: que conectar Mercado Pago empiece a pedir seña en los turnos; que el anónimo gane funciones o tablas nuevas; vender stock que no existe; confiar en datos del navegador o del webhook para dar un pago por bueno.

## Investigación (cómo lo hace Tiendanube)

- Transferencia: el cliente tiene un plazo (24 h a 3 días según la ayuda); pasado el plazo la orden se cancela sola (3 o 7 días configurables) y el stock vuelve.
- Medio de pago personalizado (efectivo, transferencia a cuenta propia): el comercio confirma el pago a mano en su panel.
- El link de transferencia con confirmación automática usa un CVU único por orden de Pago Nube (su billetera). Acá no hay equivalente: la transferencia va al alias del negocio y la confirma el dueño.

## Enfoques

1. **Pedidos propios, separados de turnos (elegido).** Tablas `productos`, `pedidos`, `pedido_items`; el pedido puede tener `turno_id`. Reutiliza la conexión de MP, el webhook y la verificación de pagos, generalizados. Sirve para la tienda suelta y para la recomendación.
2. Productos colgados del turno: no sirve para la tienda sin turno. Descartado.
3. Links de pago creados a mano en Mercado Pago: sin stock ni pedidos en la app. Descartado.

## Diseño

### Base (migración `0020_productos_y_pedidos.sql`)

- **Seña apagada en la base**: redefinir `public.monto_sena` para que devuelva 0 siempre (comentario: para reactivarla, volver a la versión de la 0001). Así conectar MP no prende la seña. `SENA_ACTIVA` en TS sigue en `false` y sigue ocultando la configuración de seña.
- `public.productos`: `negocio_id`, `nombre` (2–80), `descripcion` (≤ 500, null), `precio` numeric(12,2) > 0, `stock` int ≥ 0 (lo **disponible**: ya descontado lo apartado), `activo`, `orden`, `created_at`. RLS: miembros del negocio leen; dueños escriben (`es_dueno`). La columna `stock` también la cambian las funciones de pedidos.
- `public.producto_fotos`: como `negocio_logos` (bytea, PNG/JPEG/WebP, ≤ 512 KB, solo el rol del servidor). Se sirve en `/n/[slug]/productos/[id]/foto?v=<versión>` (cache inmutable).
- `public.pedidos`: `negocio_id`, `numero` (correlativo por negocio, para el concepto de la transferencia), `token` (64 hex), `turno_id` (null), `nombre`, `email`, `telefono`, `medio` (`mercadopago` | `transferencia` | `efectivo`), `estado` (`pendiente` | `pagado` | `entregado` | `cancelado` | `vencido` | `reembolsar`), `total`, `vence_at` (null cuando ya no hay plazo), `pago_id` (MP), `pagado_at`, `entregado_at`, `cancelado_at`, `cancelado_por` (`cliente` | `negocio` | `sistema`), `created_at`. RLS: dueños leen y actualizan solo vía funciones; empleados nada.
- `public.pedido_items`: `pedido_id`, `producto_id` (on delete set null), `nombre` y `precio_unitario` (copia al momento), `cantidad` 1–20.
- Configuración en `negocios`: `tienda_activa` bool (default false), `tienda_medios` text[] (subset de los tres; default `{efectivo}`), `transferencia_alias` (≤ 60), `transferencia_cbu` (22 dígitos, null), `transferencia_titular` (≤ 80), `transferencia_plazo_horas` (default 48, 1–168), `efectivo_plazo_dias` (default 3, 1–14). Grants de update al dueño como el resto de "Mi negocio". Transferencia solo se ofrece si hay alias o CBU.
- Funciones (`security definer`, solo `agenda2_servidor`, con `alter default privileges` ya vigente):
  - `public.crear_pedido(negocio, items jsonb, nombre, email, telefono, medio, turno_token null)`: valida tienda activa + `plataforma.negocio_toma_reservas`, medio permitido (MP requiere integración activa), productos activos del negocio; toma candado por negocio, **descuenta stock** (`update … set stock = stock - n where stock >= n`, falla con `SIN_STOCK` si no alcanza), copia nombre/precio, calcula total en la base, `vence_at`: MP 30 min, transferencia `transferencia_plazo_horas`, efectivo `efectivo_plazo_dias` o, si viene `turno_token` de un turno activo del negocio, el fin del día local del turno (lo que sea mayor). Límite: máx. 3 pedidos `pendiente` por mail (`clave_email`) por negocio. Devuelve id, token, numero, total.
  - `public.liberar_pedidos_vencidos()`: `pendiente` con `vence_at < now()` → `vencido` y devuelve el stock. Lo llama el cron.
  - `public.registrar_pago_pedido(pedido, pago_id, aprobado, monto)`: idempotente. Aprobado por el monto correcto → `pagado`. Si ya estaba `vencido`/`cancelado`: si hay stock lo vuelve a tomar y queda `pagado`; si no, `reembolsar`. Monto menor → `reembolsar`.
  - Del panel (dueño, con RLS/`es_dueno`): `public.pedido_marcar_pagado`, `public.pedido_marcar_entregado`, `public.pedido_cancelar` (devuelve stock si estaba `pendiente` o `pagado` sin entregar), `public.pedido_marcar_devuelto` (de `reembolsar` a `cancelado`). Exigen negocio habilitado (trigger existente o chequeo explícito).
  - Lectura pública de productos y del pedido por token: con el rol del servidor desde `src/lib` (como las reseñas); el anónimo sigue con sus 5 funciones.
- Escrituras del panel bajo `plataforma.tg_exigir_habilitado` como las demás tablas del negocio.

### Mercado Pago

- `integracionesDisponibles().mercadopago` pasa a depender solo del cifrado (no de `SENA_ACTIVA`). Integraciones muestra MP como "Cobrar productos con Mercado Pago"; la tarjeta de seña sigue oculta con `SENA_ACTIVA`.
- `src/lib/mercadopago.ts`: `crearPagoPedido(pedidoId)` (Checkout Pro, un item por producto, `external_reference = "pedido:<uuid>"`, `back_urls` a `/p/<token>`, `notification_url` igual que hoy, `binary_mode: true`, `excluded_payment_types: ticket, atm`, `expiration_date_to = vence_at`). `procesarPago` reconoce el prefijo: `pedido:` → `registrar_pago_pedido`; uuid suelto → turno (compatibilidad con la seña).
- Webhook sin cambios de ruta; `procesarPagoYAvisar` dispara los avisos del pedido cuando corresponde.
- La vuelta a `/p/[token]` con `payment_id` verifica igual que `/t/[token]`.

### Página pública

- `/n/[slug]`: si `tienda_activa` y hay productos activos, sección **Productos** (hasta 6, foto, precio, "Sin stock") con "Ver todos" → `/n/[slug]/productos`.
- `/n/[slug]/productos`: lista + carrito (estado en el cliente, recordado en localStorage con try/catch) → "Tus datos" (nombre, mail, celular, como la reserva) → "Cómo pagás" (medios habilitados) → confirmar. Límite por IP (`pedido:<negocio>`, 10 por hora) y validación zod. Con MP redirige a Mercado Pago; si MP no responde, a `/p/<token>` que ofrece reintentar.
- `/p/[token]` (`noindex`, `no-referrer`): número de pedido, items, total, estado y vencimiento. Transferencia: alias/CBU/titular con botón copiar, monto, "poné *Pedido #N* en el concepto" y botón de WhatsApp al negocio con el mensaje armado ("Te transferí el pedido #N"). Efectivo: "Lo retirás y pagás en el local hasta el …" (o "el día de tu turno"). MP pendiente: botón "Pagar con Mercado Pago". El cliente puede cancelar mientras está `pendiente`.
- Recomendación: en `/t/[token]?nueva=1` con turno activo y tienda activa, bloque "¿Querés sumar algo para retirar en tu turno?" con hasta 4 productos con stock → `/n/[slug]/productos?turno=<token>`: precarga nombre/mail/celular del turno y manda `turno_token` a `crear_pedido`.

### Panel (solo dueños)

- Menú: **Productos** y **Pedidos** (`soloDueno`).
- `/panel/productos`: lista y alta/edición (nombre, descripción, precio, stock, foto con `achicar-imagen`, activo, orden). Stock editable como "Disponible".
- `/panel/pedidos`: pestañas Pendientes / Pagados (por entregar) / Historial; detalle con items, cliente, medio, turno asociado (link) y botones según estado: "Pago recibido", "Entregado", "Cancelar", "Marcar como devuelto". Inicio del panel: aviso con la cantidad de pedidos pendientes y por entregar.
- `/panel/negocio`: tarjeta "Tienda": activar, medios (MP deshabilitado con link a Integraciones si no está conectado), alias/CBU/titular, plazos.

### Avisos

- Cliente: "Recibimos tu pedido #N" (link `/p/<token>` e instrucciones según el medio), "Pago confirmado", "Pedido cancelado/vencido".
- Dueños (todos): "Nuevo pedido #N" (con medio y total) y "Pago recibido por Mercado Pago". Por `after()`, como los de reservas.

### Cron

- Paso nuevo: `liberar_pedidos_vencidos()` cada hora (también al cargar la tienda no hace falta: el stock vencido vuelve a la hora). Nota: con MP (30 min) el stock puede quedar apartado hasta ~1 h 30; aceptable.

## Lo que decidí yo (para que lo revises)

- El stock se descuenta al **crear** el pedido (apartado) y vuelve si se cancela o vence; "pagado" no vuelve a descontar. Es lo que hace Tiendanube y evita vender dos veces la última unidad.
- Plazos por defecto: MP 30 min, transferencia 48 h, efectivo 3 días (o hasta el día del turno). Configurables, salvo MP.
- Máx. 3 pedidos pendientes por mail por negocio y 10 por hora por IP.
- Sin envíos: todo se retira en el local.
- La seña se apaga también en la base (`monto_sena` = 0).
- El cliente puede cancelar su pedido pendiente desde `/p/[token]`.

## Lo que queda al builder

Nombres exactos de componentes, textos, diseño visual de tarjetas siguiendo la identidad (`marca-*`, `tema-negocio`), forma del carrito, cantidad de productos en la recomendación, orden de pestañas en Pedidos.
