# Turnia — agenda y reservas online de turnos

MVP de agenda y reservas para negocios de servicios (peluquerías, barberías, uñas, estética).
Los clientes reservan desde el celular sin crear cuenta y el negocio gestiona todo desde `/panel`.

- **Stack:** Next.js 16 (App Router) + TypeScript + Tailwind CSS 4 + Supabase (Postgres, Auth, RLS) + FullCalendar 7 + Resend.
- **Integraciones (opcionales):** Google Calendar, seña con Mercado Pago, avisos por WhatsApp (Cloud API).
- **Idioma/zona:** todo en es-AR. Fechas en UTC (`timestamptz`), mostradas en `America/Argentina/Buenos_Aires`.
- **Marca:** el nombre "Turnia" está centralizado en `src/lib/marca.ts` y es fácil de cambiar.

---

## Puesta en marcha (desarrollo local)

### 1. Requisitos

- Node.js 20+ (probado con Node 24).
- **Docker Desktop**, que Supabase local necesita. En Windows hay que instalar WSL2 primero:
  1. En PowerShell como administrador: `wsl --install` y reiniciar.
  2. Instalar Docker Desktop desde https://www.docker.com/products/docker-desktop/ y abrirlo.

### 2. Levantar Supabase local

```bash
npm install
npm run db:start      # = npx supabase start (la primera vez descarga imágenes, tarda)
```

Al terminar, el comando imprime las URLs y claves. Copiá `.env.example` a `.env.local` y completalo con esos datos:

| Variable | Valor en `supabase start` |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `API URL` (http://127.0.0.1:54321) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `anon key` (o `Publishable key`) |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role key` (o `Secret key`). **Solo servidor.** |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` |

`supabase start` aplica las migraciones de `supabase/migrations` y carga `supabase/seed.sql`.
Para volver la base a cero: `npm run db:reset`.

### 3. Correr la app

```bash
npm run dev
```

- App: http://localhost:3000
- Supabase Studio (ver tablas): http://127.0.0.1:54323
- Mails de prueba de Supabase Auth (Mailpit): http://127.0.0.1:54324

### Datos de prueba (seed)

- Dueña: **demo@turnos.test / demo1234**, negocio "Estudio Luna" con 2 profesionales y 4 servicios.
- Página pública: http://localhost:3000/n/estudio-luna

---

## Scripts

| Script | Qué hace |
| --- | --- |
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Build de producción |
| `npm run typecheck` | Genera los tipos de rutas y corre `tsc` |
| `npm run lint` | ESLint |
| `npm run test:db` | **Prueba las migraciones y la seguridad (RLS) sin Docker**, con Postgres embebido (PGlite) |
| `npm run db:start` / `db:reset` | Supabase local |
| `npm run db:tipos` | Genera `src/lib/database.types.ts` desde la base local (opcional) |

---

## Estructura

```
supabase/
  migrations/
    ..._esquema.sql          tablas, restricciones, exclusión anti-superposición
    ..._seguridad.sql        RLS + helpers (mi_negocio_id, es_dueno, ...)
    ..._funciones_panel.sql  crear_negocio, guardar_horarios, guardar_servicios_profesional
    ..._reservas.sql         negocio_publico, horarios_libres, dias_disponibles,
                             crear_reserva, ver_turno, cancelar_turno_cliente, crear_turno_panel
    ..._recordatorios.sql    reclamar_recordatorios (cron de mails)
    ..._integraciones.sql    seña (retención + registrar_pago), Google (cola de sincronización,
                             ocupados), WhatsApp, límites de uso, estadísticas
  seed.sql
scripts/test-db.mjs          tests de base de datos (PGlite)
src/
  proxy.ts                   (ex "middleware") refresca sesión y protege /panel, /onboarding, /cuenta
  lib/
    auth.ts                  getSesion, requerirPanel, requerirDueno, sesionParaAccion
    supabase/                clientes server / proxy / admin (service role)
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
    auth/confirmar/          canje de links de email (confirmación, invitación, recuperación)
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

1. **Proxy** (`src/proxy.ts`): sin sesión no se entra a `/panel`, `/onboarding` ni `/cuenta`.
2. **Servidor**: el layout del panel exige un perfil (dueño o empleado). Las páginas de dueño usan `requerirDueno()`. Cada Server Action vuelve a verificar sesión y rol, y valida el input con zod.
3. **RLS en Postgres**, que es la capa que importa:
   - `anon` (público) **no tiene acceso a ninguna tabla**. El portal público solo usa funciones RPC `security definer` que devuelven lo mínimo necesario y validan su propio input.
   - Dueño: lee y escribe solo su negocio (`negocio_id = mi_negocio_id()`).
   - Empleado: lee la configuración del negocio, pero solo ve y modifica los turnos, ausencias y clientes **de su propia agenda**.
   - Los permisos de UPDATE están limitados por columna (nadie puede mover un registro a otro negocio).
   - Las FK compuestas `(negocio_id, id)` impiden que un turno apunte a un profesional o servicio de otro negocio.
4. **Turnos duplicados**: hay una restricción de exclusión `EXCLUDE USING gist (profesional_id WITH =, tstzrange(inicio, fin) WITH &&) WHERE estado <> 'cancelado'`. Aunque dos personas reserven a la vez, Postgres rechaza la segunda reserva. Con "cualquier profesional", `crear_reserva` prueba con el siguiente libre.
5. **Token del turno**: tiene 64 caracteres hex aleatorios. La página `/t/[token]` es `noindex` y `no-referrer`.
6. **Anti-abuso**: máximo 3 turnos futuros activos por teléfono y negocio, y límite de pedidos por IP (hash) en reservar y consultar horarios.
7. **Secretos de terceros**: los tokens de Google y Mercado Pago se guardan cifrados (AES-256-GCM, `INTEGRACIONES_CLAVE`) en `integraciones_secretos`, una tabla a la que ni `anon` ni `authenticated` tienen acceso: solo el servidor.
8. **Pagos**: nunca se confía en los parámetros que llegan del navegador ni en el cuerpo del webhook. El pago se consulta a la API de Mercado Pago con el token del negocio y solo se registra si es la seña de un turno de ese negocio, por el monto correcto.

`npm run test:db` verifica todo esto: aislamiento entre negocios, rol empleado, anon sin acceso, turnos superpuestos, política de cancelación, bloqueos, recordatorios, señas (retención, vencimiento, pago tardío), secretos de integraciones, cola de Google, límites de uso y estadísticas.

---

## Cómo probar cada fase

### Fase 1: negocio, servicios, profesionales, roles
1. Entrá a `/registro` y creá una cuenta. En local no hace falta confirmar el mail; te lleva a `/onboarding`.
2. Creá el negocio. Si marcás "Yo también atiendo", quedás creado como profesional.
3. En **Servicios**, cargá servicios con duración y precio.
4. En **Profesionales**, creá a alguien más, marcá qué servicios hace y cargá su horario semanal (podés usar varias franjas por día y el botón "Copiar a lunes–viernes").
5. **Accesos**: invitá a un empleado y vinculalo a un profesional. Se genera un link para compartir por WhatsApp. Abrilo en una ventana de incógnito, elegí la contraseña y vas a ver que **solo aparece su agenda**, sin Servicios, Profesionales ni Mi negocio. Si escribís esas URLs a mano, te redirige.
6. Con un usuario recién registrado sin negocio, `/panel` redirige a `/onboarding`.

### Fase 2: reservas públicas
1. Abrí `/n/<tu-slug>` (o `/n/estudio-luna` con el seed) desde el celular o con el modo responsive del navegador.
2. Elegí servicio, profesional o "Cualquiera", día y horario. Completá nombre y celular; el mail es opcional.
3. Te lleva a `/t/<token>`: ahí ves el turno y lo podés cancelar hasta X horas antes (se configura en **Mi negocio**).
4. Para probar la concurrencia, abrí el mismo horario en dos pestañas y confirmá en las dos. La segunda recibe "Ese horario ya no está disponible".

### Fase 3: agenda
1. En **Agenda** tenés la vista semanal (diaria en el celular) con colores por profesional. Las ausencias aparecen en gris.
2. Arrastrá un turno para moverlo o estiralo para cambiar su duración. Si se superpone con otro, vuelve a su lugar con un aviso.
3. Tocá un hueco para agendar un turno manual. Tocá un turno para confirmarlo, marcarlo como atendido, cancelarlo o escribirle al cliente por WhatsApp.
4. **Turnos**: listado con filtros y detalle con reprogramación y notas internas. **Clientes**: listado con búsqueda.
5. **Ausencias**: vacaciones o trámites. Esos horarios desaparecen de la página pública.

### Fase 4: mails
- Sin `RESEND_API_KEY`, los mails no se envían y se registran en la consola del servidor.
- Para enviarlos de verdad: creá una cuenta en https://resend.com, verificá tu dominio y completá `RESEND_API_KEY` y `EMAIL_FROM`.
- Se envían estos mails:
  - **Confirmación** al reservar online, si el cliente dejó su email.
  - **Aviso** cuando el negocio cancela o reprograma el turno.
  - **Recordatorio** X horas antes (configurable en Mi negocio).
- El cron de tareas: `GET /api/cron` con el header `Authorization: Bearer <CRON_SECRET>`. Libera señas vencidas, manda recordatorios (mail y WhatsApp), sincroniza Google Calendar y limpia contadores. En Vercel queda programado cada hora por `vercel.json` (el plan gratuito de Vercel solo permite crons diarios: en ese caso usá un cron externo). En otro hosting, usá cualquier cron externo, por ejemplo:
  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" https://tu-dominio/api/cron
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
1. Necesitás `INTEGRACIONES_CLAVE` y `SUPABASE_SERVICE_ROLE_KEY`. No hay variables de Mercado Pago: cada negocio conecta la suya.
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

### Extras
- **Estadísticas** (dueño): turnos, facturación estimada, cancelaciones, reservas online, servicios y profesionales más pedidos, días con más turnos.
- **Clientes**: ficha con historial, visitas, gasto y notas internas. También se puede exportar la lista a CSV para Excel.
- **Turno del cliente**: se puede agregar a Google Calendar o descargar `.ics` (Apple, Outlook).
- **Link de reservas**: al compartirlo muestra una vista previa con el nombre del negocio.

---

## Producción (Supabase cloud)

1. Creá un proyecto en supabase.com y vinculalo: `npx supabase link --project-ref <ref>`.
2. Subí las migraciones con `npx supabase db push`. El seed **no** se sube.
3. En Auth → URL Configuration, cargá el `Site URL` y agregá `https://tu-dominio/**` a los redirect URLs.
4. En Auth → Email Templates, para que los links funcionen con SSR, cambiá el link de **Confirm signup**, **Invite** y **Reset password** por:
   `{{ .SiteURL }}/auth/confirmar?token_hash={{ .TokenHash }}&type=email&next=/onboarding`
   (usá `type=invite` y `next=/cuenta/password` para la invitación, y `type=recovery` con `next=/cuenta/password` para el reset).
5. Configurá las variables de `.env.example` en el hosting, con `NEXT_PUBLIC_SITE_URL` en `https://…`. Es necesario para que Mercado Pago acepte el webhook y la vuelta automática.
6. Agregá la URI `https://tu-dominio/api/google/callback` a las credenciales de Google y publicá la pantalla de consentimiento. Google pide verificar la app para el permiso de calendario si la van a usar más de 100 cuentas.

---

## Decisiones y límites conocidos

- **Google Calendar** se conecta por profesional, no por negocio, porque la agenda es de cada persona. Turnia es la fuente de verdad: si alguien mueve el evento en Google, no cambia el turno.
- **Ocupados de Google**: se importan cada hora, así que un evento recién creado puede tardar hasta una hora en bloquear horarios, salvo que se use "Sincronizar ahora".
- **Mercado Pago**: cada negocio pega su Access Token. Es más simple que el OAuth de marketplace, que requiere homologar la app como plataforma, y el dinero va igual directo al negocio. Si la plataforma quiere cobrar comisión, hay que pasar a OAuth + `marketplace_fee`.
- **Devoluciones** de seña: se hacen desde Mercado Pago y en Turnia se registran a mano. Todavía no hay reembolso automático por API.
- **WhatsApp automático**: usa un número de la plataforma. Para que cada negocio mande desde su propio número, cada uno tendría que tener su cuenta de WhatsApp Business API.

## Ideas para después

- Vista por columnas de profesional en la agenda (en FullCalendar es una función premium; hoy se filtra por profesional y se distingue por color).
- Ordenar servicios y profesionales arrastrando (la columna `orden` ya existe).
- Reembolso automático de la seña al cancelar dentro del plazo.
- Listas de espera y reservas recurrentes.
