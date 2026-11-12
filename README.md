# Agenda2 — agenda y reservas online de turnos

MVP de agenda y reservas para negocios de servicios (peluquerías, barberías, uñas, estética).
Los clientes reservan desde el celular sin crear cuenta y el negocio gestiona todo desde `/panel`.

- **Stack:** Next.js 16 (App Router) + TypeScript + Tailwind CSS 4 + PostgreSQL 18 (node-postgres, RLS) + Better Auth + FullCalendar 7 + Resend.
- **Integraciones (opcionales):** Google Calendar, avisos por WhatsApp (Cloud API) y seña con Mercado Pago (hoy oculta, ver Fase 6).
- **Idioma/zona:** todo en es-AR. Fechas en UTC (`timestamptz`), mostradas en `America/Argentina/Buenos_Aires`.
- **Marca:** el nombre "Agenda2" está centralizado en `src/lib/marca.ts` y es fácil de cambiar.

---

## Puesta en marcha (desarrollo local)

### 1. Requisitos

- Node.js 20+ (probado con Node 24). **No hace falta Docker** ni instalar Postgres: `npm run db:local` usa los binarios de PostgreSQL 18 del paquete `embedded-postgres`.

### 2. Base de datos local

```bash
npm install
cp .env.example .env.local   # ya trae las URLs de la base local; completá BETTER_AUTH_SECRET
npm run db:local             # Postgres en 127.0.0.1:54329, datos en .pgdata/ (Ctrl+C lo apaga)
```

La primera vez crea los roles (`db/roles.sql`), la base `agenda2`, las tablas (`db/migraciones/`) y los datos demo (`db/seed.sql`). Las siguientes, solo aplica migraciones nuevas. Para volver la base a cero: `npm run db:reset` (con `db:local` corriendo). Para empezar de cero del todo, borrá `.pgdata/`.

### 3. Correr la app

En otra terminal:

```bash
npm run dev
```

- App: http://localhost:3000
- Sin `RESEND_API_KEY`, los mails no se envían y salen **enteros en la consola** de `npm run dev`: ahí están los links para confirmar la cuenta y recuperar la contraseña.

### Datos de prueba (seed)

- Dueña: **demo@turnos.test / demo1234**, negocio "Estudio Luna" con 2 profesionales y 4 servicios → http://localhost:3000/n/estudio-luna
- Dueño: **barbero@turnos.test / demo1234**, "Peluquería Caballeros" → http://localhost:3000/n/peluqueria-caballeros
- Admin de la plataforma: **admin@turnos.test / demo1234** → http://localhost:3000/admin (la primera vez pide configurar el segundo factor con una app autenticadora)

---

## Scripts

| Script | Qué hace |
| --- | --- |
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Build de producción |
| `npm run typecheck` | Genera los tipos de rutas y corre `tsc` |
| `npm run lint` | ESLint |
| `npm run test:db` | **Prueba las migraciones, los roles y la seguridad (RLS)** con Postgres embebido (PGlite) |
| `npm run db:local` | Postgres 18 local (sin Docker) |
| `npm run db:migrar` | Aplica las migraciones pendientes (con `DATABASE_URL_MIGRAR`) |
| `npm run db:seed` / `db:reset` | Datos demo / borrar todo, migrar y cargar el seed (solo base local) |
| `npm run admin -- agregar <mail>` | Hace admin de la plataforma a una cuenta ya registrada (`listar`, `quitar`, `quitar-2fa`) |

---

## Estructura

```
db/
  roles.sql                  roles agenda2_* y la base (se corre una vez como superusuario)
  migraciones/
    0001_inicial.sql         esquema completo: tablas de Better Auth (auth), tablas del negocio,
                             RLS, funciones del panel, del portal público y del servidor, permisos
  migrar.mjs                 migrador (app.schema_version, checksum, candado)
  seed.sql / seed.mjs        datos demo y sus usuarios
deploy/                      systemd (web, cron, backup) y bloque de Caddy
scripts/
  test-db.mjs                tests de base de datos (PGlite)
  db-local.mjs               Postgres local embebido
  migrar.mjs / seed.mjs      npm run db:migrar / db:seed / db:reset
  backup-db.sh               pg_dump diario
src/
  proxy.ts                   (ex "middleware") valida la sesión y protege /panel y /onboarding
  lib/
    db/                      pool de pg, plantilla sql, comoUsuario / comoAnonimo / comoServidor
    better-auth.ts           configuración de Better Auth (cuentas, sesiones, mails)
    auth.ts                  getSesion, requerirPanel, requerirDueno, sesionParaAccion
    accesos.ts               links de acceso del equipo (invitación y recuperación)
    datos-panel.ts           turnos y eventos de la agenda
    validaciones.ts          esquemas zod (todo input se valida en el servidor)
    fechas.ts                helpers UTC <-> hora local del negocio
    email/                   Resend, plantillas, notificaciones
    google.ts                Google Calendar (OAuth, eventos, ocupados)
    mercadopago.ts           preferencias de pago y verificación de pagos
    whatsapp.ts / whatsapp-api.ts   links wa.me y envío por Cloud API
    integraciones.ts         lectura/escritura de integraciones y secretos cifrados (cifrado.ts)
    eventos.ts               qué pasa después de una reserva o un pago (avisos, sincronización)
    limites.ts               límite de pedidos por IP
  app/
    (auth)/                  login, registro, recuperar contraseña
    api/auth/                Better Auth: solo los links de los mails (verificación y recuperación)
    cuenta/password/         elegir contraseña nueva con el link de recuperación
    acceso/[token]/          link de acceso de un empleado (invitación o recuperación)
    onboarding/              alta del negocio
    panel/                   panel de gestión (dueño / empleado)
    n/[slug]/                portal público de reservas
    t/[token]/               ver / cancelar turno sin login
    api/cron/                tareas periódicas (señas vencidas, recordatorios, Google)
    api/google/              conectar/callback de Google Calendar
    api/mercadopago/webhook/ notificaciones de pago
```

---

## Seguridad: cómo está armada

1. **Proxy** (`src/proxy.ts`): sin una sesión válida (verificada en la base) no se entra a `/panel` ni a `/onboarding`.
2. **Servidor**: el layout del panel exige un perfil (dueño o empleado). Las páginas de dueño usan `requerirDueno()`. Cada Server Action vuelve a verificar sesión y rol, y valida el input con zod.
3. **Roles de Postgres + RLS**, que es la capa que importa:
   - La app entra como `agenda2_app`, que **no hereda permisos**: cada consulta corre en una transacción que cambia de rol (`SET LOCAL ROLE`) a `agenda2_usuario` (panel), `agenda2_anonimo` (portal) o `agenda2_servidor` (reservas, cron). Si una consulta se escapara sin cambiar de rol, la base la rechaza.
   - El anónimo **no tiene acceso a ninguna tabla**. El portal público solo usa 5 funciones `security definer` que devuelven lo mínimo necesario y validan su propio input.
   - Dueño: lee y escribe solo su negocio (`negocio_id = mi_negocio_id()`).
   - Empleado: lee la configuración del negocio, pero solo ve y modifica los turnos y ausencias **de su propia agenda**. No lee fichas de clientes: de sus turnos ve el nombre, mail y celular con que se pidieron.
   - Better Auth tiene su propio rol (`agenda2_auth`) y esquema (`auth`): ni el panel ni el servidor leen contraseñas o sesiones.
   - Los permisos de UPDATE están limitados por columna (nadie puede mover un registro a otro negocio).
   - Las FK compuestas `(negocio_id, id)` impiden que un turno apunte a un profesional o servicio de otro negocio.
4. **Turnos duplicados**: hay una restricción de exclusión `EXCLUDE USING gist (profesional_id WITH =, tstzrange(inicio, fin) WITH &&) WHERE estado <> 'cancelado'`. Aunque dos personas reserven a la vez, Postgres rechaza la segunda reserva. Con "cualquier profesional", `crear_reserva` prueba con el siguiente libre.
5. **Token del turno**: tiene 64 caracteres hex aleatorios. La página `/t/[token]` es `noindex` y `no-referrer`.
6. **Anti-abuso**: la reserva online pide email y, por negocio, permite un turno por fecha con cada email, máximo 3 turnos futuros (por email o celular) y uno solo a la vez con 3 inasistencias sin perdonar. Los turnos cancelados no cuentan y desde el panel no hay límites. También hay límite de pedidos por IP (hash) en reservar y consultar horarios.
7. **Secretos de terceros**: los tokens de Google y Mercado Pago se guardan cifrados (AES-256-GCM, `INTEGRACIONES_CLAVE`) en `integraciones_secretos`, una tabla a la que ni el anónimo ni los usuarios del panel tienen acceso: solo el servidor.
8. **Sesión**: cookie httpOnly (`Secure` en producción). Registro con verificación de mail obligatoria, recuperación de contraseña de un solo uso que cierra las demás sesiones, y límite de intentos por IP en login, registro y recuperación. Por `/api/auth` solo pasan los links de los mails.
9. **Pagos**: nunca se confía en los parámetros que llegan del navegador ni en el cuerpo del webhook. El pago se consulta a la API de Mercado Pago con el token del negocio y solo se registra si es la seña de un turno de ese negocio, por el monto correcto.

`npm run test:db` verifica todo esto: roles (la app sin cambiar de rol no lee nada; el anónimo ejecuta solo las 5 funciones públicas), aislamiento entre negocios en todas las tablas, dueño contra empleado, turnos superpuestos, política de cancelación, bloqueos, recordatorios, señas (retención, vencimiento, pago tardío), secretos de integraciones, cola de Google, límites de uso y estadísticas.

---

## Cómo probar cada fase

### Fase 1: negocio, servicios, profesionales, roles
1. Entrá a `/registro` y creá una cuenta. Abrí el link de confirmación (en local está en la consola de `npm run dev`): inicia sesión y te lleva a `/onboarding`.
2. Creá el negocio. Si marcás "Yo también atiendo", quedás creado como profesional.
3. En **Servicios**, cargá servicios con duración y precio.
4. En **Profesionales**, creá a alguien más, marcá qué servicios hace y cargá su horario semanal (podés usar varias franjas por día y el botón "Copiar a lunes–viernes").
5. **Accesos**: invitá a un empleado y vinculalo a un profesional. Se genera un link de un solo uso (`/acceso/…`, vence en 24 h) para compartir por WhatsApp. Abrilo en una ventana de incógnito, elegí la contraseña y vas a ver que **solo aparece su agenda**, sin Servicios, Profesionales, Clientes ni Mi negocio. Si escribís esas URLs a mano, te redirige. Si el empleado olvida la contraseña, "Nuevo link de acceso" le genera otro.
6. Con un usuario recién registrado sin negocio, `/panel` redirige a `/onboarding`.

### Fase 2: reservas públicas
1. Abrí `/n/<tu-slug>` (o `/n/estudio-luna` con el seed) desde el celular o con el modo responsive del navegador.
2. Elegí servicio, profesional o "Cualquiera", día y horario. Completá nombre, celular y mail (obligatorio).
3. Te lleva a `/t/<token>`: ahí ves el turno y lo podés cancelar hasta X horas antes (se configura en **Mi negocio**).
4. Para probar la concurrencia, abrí el mismo horario en dos pestañas y confirmá en las dos. La segunda recibe "Ese horario ya no está disponible".

### Fase 3: agenda
1. En **Agenda** tenés la vista semanal (diaria en el celular) con colores por profesional. Las ausencias aparecen en gris.
2. Arrastrá un turno para moverlo o estiralo para cambiar su duración. Si se superpone con otro, vuelve a su lugar con un aviso.
3. Tocá un hueco para agendar un turno manual. Tocá un turno para confirmarlo, marcarlo como atendido, cancelarlo o escribirle al cliente por WhatsApp.
4. **Turnos**: listado con filtros y detalle con reprogramación y notas internas. **Clientes**: listado con búsqueda.
5. **Ausencias**: vacaciones o trámites. Esos horarios desaparecen de la página pública.

### Fase 4: mails
- Sin `RESEND_API_KEY`, los mails no se envían: en desarrollo se muestran enteros en la consola del servidor.
- Para enviarlos de verdad: creá una cuenta en https://resend.com, verificá el dominio (`agenda2.tech`) y completá `RESEND_API_KEY` y `EMAIL_FROM`.
- Se envían estos mails:
  - **Cuenta**: confirmación del email al registrarse y link para recuperar la contraseña (Better Auth).
  - **Confirmación** al reservar online.
  - **Aviso** cuando el negocio cancela, confirma o reprograma el turno.
  - **Recordatorio** X horas antes (configurable en Mi negocio).
- El cron de tareas: `GET /api/cron` con el header `Authorization: Bearer <CRON_SECRET>`. Libera señas vencidas, manda recordatorios (mail y WhatsApp), sincroniza Google Calendar y limpia contadores y links vencidos. En el servidor lo llama `deploy/agenda2-cron.timer` cada hora. A mano:
  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron
  ```

### Fase 5: Google Calendar
1. En https://console.cloud.google.com creá un proyecto, habilitá **Google Calendar API** y configurá la pantalla de consentimiento (tipo "Externo"; mientras esté "en prueba", agregá tus cuentas como usuarios de prueba).
2. Credenciales → **ID de cliente OAuth** → "Aplicación web". URI de redirección: `http://localhost:3000/api/google/callback` (y la de producción).
3. Completá `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `INTEGRACIONES_CLAVE` en `.env.local` y reiniciá `npm run dev`.
4. Panel → **Integraciones** → "Conectar" al lado de cada profesional. Cada empleado ve solo su propia fila y conecta su cuenta desde su usuario.
5. Qué hace:
   - Cada turno activo aparece en el calendario del profesional. Se actualiza si lo movés, lo pasás a otro profesional o lo cancelás (se borra).
   - Opcional (activado por defecto): lo que el profesional tiene **ocupado** en Google se importa como ausencia y no se ofrece online. Los eventos marcados como "Disponible" o rechazados se ignoran. Se actualiza cada hora con el cron o con "Sincronizar ahora".
   - Si falla Google, el cambio queda en cola y el cron lo reintenta.
   - Al desconectar, se borran del calendario los turnos futuros que se habían creado y las ausencias importadas.

### Fase 6: seña con Mercado Pago

> **Hoy está oculta**: `SENA_ACTIVA = false` en `src/lib/env.ts`. El código y la base siguen intactos; para volver a ofrecerla, alcanza con pasarlo a `true`.
1. Necesitás `INTEGRACIONES_CLAVE`. No hay variables de Mercado Pago: cada negocio conecta la suya.
2. Panel → **Integraciones** → pegá el **Access Token**. Para probar, usá las credenciales de prueba (`TEST-…`) de https://www.mercadopago.com.ar/developers/panel/app y pagá con una [tarjeta de prueba](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/additional-content/your-integrations/test/cards).
3. Configurá la seña (porcentaje del precio o monto fijo) y el plazo para pagar.
4. Flujo del cliente:
   - Reserva y va directo a Mercado Pago. El horario queda **retenido** durante el plazo.
   - Al volver se verifica el pago y el turno queda confirmado; recién ahí salen los mails y avisos.
   - Si no paga a tiempo, el horario se libera solo.
   - Si paga tarde: se recupera el turno si el horario sigue libre. Si no, queda marcado "seña a devolver" y el panel lo avisa.
5. Del lado del negocio:
   - En el detalle del turno: "Ya la cobré por otro medio" (efectivo o transferencia) y "Marcar como devuelta".
   - Confirmar a mano un turno que esperaba la seña lo toma igual, sin seña.
6. En local, Mercado Pago no puede llamar al webhook (`localhost` no es público). La confirmación funciona igual porque se verifica al volver a `/t/<token>`. En producción, el webhook (`/api/mercadopago/webhook?negocio=<id>`) se configura solo en cada pago.

### Fase 6: WhatsApp
- **Sin configurar nada**:
  - En el detalle de cada turno hay botones que abren WhatsApp con el mensaje listo: confirmar, recordar, pedir la seña o avisar un cambio.
  - El cliente tiene un botón para escribirle al negocio.
- **Automático (opcional)**, con la API oficial de WhatsApp (Meta Cloud API):
  1. Creá una app en https://developers.facebook.com con el producto WhatsApp.
  2. Cargá `WHATSAPP_TOKEN` y `WHATSAPP_PHONE_NUMBER_ID`.
  3. Creá y hacé aprobar dos plantillas de categoría "Utility", en idioma Español (ARG), con 5 parámetros en el cuerpo: `{{1}}` nombre, `{{2}}` negocio, `{{3}}` servicio, `{{4}}` fecha y hora, `{{5}}` link al turno. Ejemplo de recordatorio: *"Hola {{1}}! Te recordamos tu turno en {{2}} ({{3}}) el {{4}}. Si no podés venir, cancelalo acá: {{5}}"*.
  4. Poné sus nombres en `WHATSAPP_PLANTILLA_CONFIRMACION` y `WHATSAPP_PLANTILLA_RECORDATORIO`.
  5. Cada negocio activa los avisos en Panel → Integraciones.

### Suscripciones y panel de la plataforma (`/admin`)
- Cada negocio nuevo tiene **7 días de prueba**. Después paga un plan mensual, que el admin registra a mano en `/admin` (monto, medio, meses). Si no paga: 5 días de gracia con aviso y después el panel queda en **solo lectura** y la página deja de tomar reservas (los turnos ya reservados siguen). El admin también puede suspender, reactivar y extender la prueba.
- El dueño ve un aviso en el panel (días de prueba que le quedan, vencimiento, bloqueo) y le llegan mails 3 días antes, al vencer y al bloquearse.
- `/admin`: negocios con filtros y búsqueda; detalle con pagos, configuración en solo lectura (para ayudarlos), contacto, notas internas e historial de todo lo que hizo el admin. No muestra clientes ni lo que factura cada negocio.
- Se entra con contraseña **y** el código de una app autenticadora (Google Authenticator, etc.).
- Probar: entrar como `admin@turnos.test`, configurar el segundo factor, registrar un pago a "Peluquería Caballeros", suspenderla y ver `/n/peluqueria-caballeros` y el panel de `barbero@turnos.test`.

### Extras
- **Estadísticas** (dueño): turnos, facturación estimada, cancelaciones, reservas online, servicios y profesionales más pedidos, días con más turnos.
- **Clientes**: ficha con historial, visitas, gasto y notas internas. También se puede exportar la lista a CSV para Excel.
- **Turno del cliente**: se puede agregar a Google Calendar o descargar `.ics` (Apple, Outlook).
- **Link de reservas**: al compartirlo muestra una vista previa con el nombre del negocio.

---

## Producción (VPS propio: PostgreSQL 18 + Node 24 + Caddy)

El paso a paso completo está en `CLAUDE.md`, sección **"Publicar en el VPS"**. En resumen:

1. Usuario Linux `agenda2`, código en `/srv/agenda2/web` (`git clone`).
2. Roles y base, una vez, como superusuario: `sudo -u postgres psql -v clave_dueno=… -v clave_app=… -f db/roles.sql`.
3. `.env.production.local` (app: `DATABASE_URL` como `agenda2_app`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`…) y `.env.migrar.local` (solo `DATABASE_URL_MIGRAR` como `agenda2_dueno`).
4. `npm ci && npm run db:migrar && npm run build`, y los servicios de `deploy/`: `agenda2-web` (Next en `127.0.0.1:3002`), `agenda2-cron.timer` (cada hora) y `agenda2-backup.timer` (`pg_dump` diario).
5. Caddy con el bloque de `deploy/Caddyfile` (en `/etc/caddy/sitios/agenda2.caddy`) (HTTPS automático, pisa `X-Forwarded-For` con la IP real).

Actualizar: `git pull && npm ci && npm run db:migrar && npm run build && systemctl restart agenda2-web`.

Para activar más adelante: las variables de Google (con `https://agenda2.tech/api/google/callback` como URI autorizada) y las de WhatsApp. La seña con Mercado Pago se activa además con `SENA_ACTIVA` en `src/lib/env.ts`.

---

## Decisiones y límites conocidos

- **Google Calendar** se conecta por profesional, no por negocio, porque la agenda es de cada persona. Agenda2 es la fuente de verdad: si alguien mueve el evento en Google, no cambia el turno.
- **Ocupados de Google**: se importan cada hora, así que un evento recién creado puede tardar hasta una hora en bloquear horarios, salvo que se use "Sincronizar ahora".
- **Mercado Pago**: cada negocio pega su Access Token. Es más simple que el OAuth de marketplace, que requiere homologar la app como plataforma, y el dinero va igual directo al negocio. Si la plataforma quiere cobrar comisión, hay que pasar a OAuth + `marketplace_fee`.
- **Devoluciones** de seña: se hacen desde Mercado Pago y en Agenda2 se registran a mano. Todavía no hay reembolso automático por API.
- **WhatsApp automático**: usa un número de la plataforma. Para que cada negocio mande desde su propio número, cada uno tendría que tener su cuenta de WhatsApp Business API.

## Ideas para después

- Vista por columnas de profesional en la agenda (en FullCalendar es una función premium; hoy se filtra por profesional y se distingue por color).
- Ordenar servicios y profesionales arrastrando (la columna `orden` ya existe).
- Reembolso automático de la seña al cancelar dentro del plazo.
- Listas de espera y reservas recurrentes.
