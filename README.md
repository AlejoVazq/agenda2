# Turnia — agenda y reservas online de turnos

MVP de agenda y reservas para negocios de servicios (peluquerías, barberías, uñas, estética).
Los clientes reservan desde el celular sin crear cuenta y el negocio gestiona todo desde `/panel`.

- **Stack:** Next.js 16 (App Router) + TypeScript + Tailwind CSS 4 + Supabase (Postgres, Auth, RLS) + FullCalendar 7 + Resend.
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
  app/
    (auth)/                  login, registro, recuperar contraseña
    auth/confirmar/          canje de links de email (confirmación, invitación, recuperación)
    onboarding/              alta del negocio
    panel/                   panel de gestión (dueño / empleado)
    n/[slug]/                portal público de reservas
    t/[token]/               ver / cancelar turno sin login
    api/cron/recordatorios/  endpoint del cron de recordatorios
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
6. **Anti-abuso básico**: máximo 3 turnos futuros activos por teléfono y negocio.

`npm run test:db` verifica todo esto: aislamiento entre negocios, rol empleado, anon sin acceso, turnos superpuestos, política de cancelación, bloqueos y recordatorios.

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
- El cron de recordatorios: `GET /api/cron/recordatorios` con el header `Authorization: Bearer <CRON_SECRET>`. En Vercel queda programado cada hora por `vercel.json`. En otro hosting, usá cualquier cron externo, por ejemplo:
  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" https://tu-dominio/api/cron/recordatorios
  ```

---

## Producción (Supabase cloud)

1. Creá un proyecto en supabase.com y vinculalo: `npx supabase link --project-ref <ref>`.
2. Subí las migraciones con `npx supabase db push`. El seed **no** se sube.
3. En Auth → URL Configuration, cargá el `Site URL` y agregá `https://tu-dominio/**` a los redirect URLs.
4. En Auth → Email Templates, para que los links funcionen con SSR, cambiá el link de **Confirm signup**, **Invite** y **Reset password** por:
   `{{ .SiteURL }}/auth/confirmar?token_hash={{ .TokenHash }}&type=email&next=/onboarding`
   (usá `type=invite` y `next=/cuenta/password` para la invitación, y `type=recovery` con `next=/cuenta/password` para el reset).
5. Configurá las variables de `.env.example` en el hosting.

---

## Preparado para fases siguientes (sin implementar)

- **Google Calendar (fase 5)**: `turnos.google_event_id`, `profesionales.google_calendar_id` y la tabla `integraciones` (proveedor `google_calendar`, `config jsonb`, solo visible para el dueño).
- **Mercado Pago (fase 6)**: `turnos.pago_estado`, `turnos.pago_id` e `integraciones` (proveedor `mercadopago`).
- **WhatsApp (fase 6)**: `integraciones` (proveedor `whatsapp`). Hoy hay links `wa.me` manuales en el panel.

## Pendientes conocidos / ideas

- Rate limiting real en las acciones públicas (por IP), por ejemplo con Upstash o Vercel KV.
- Mail al dueño cuando entra una reserva nueva.
- Vista por columnas de profesional en la agenda (en FullCalendar es una función premium; hoy se filtra por profesional y se distingue por color).
- Ordenar servicios y profesionales arrastrando (la columna `orden` ya existe).
