@AGENTS.md

# Agenda2

App de agenda y reservas online de turnos para negocios de servicios en Argentina (peluquería masculina/femenina, barbería, uñas, estética). El cliente reserva desde el celular sin crear cuenta (`/n/[slug]`) y el negocio gestiona todo desde `/panel`. Antes se llamó "Turnia": el nombre visible está solo en `src/lib/marca.ts`.

- Todo en **español es-AR**: código, nombres de archivos, variables, textos y commits.
- Fechas en UTC (`timestamptz`), se muestran en `America/Argentina/Buenos_Aires` (helpers en `src/lib/fechas.ts`, usa `temporal-polyfill`).
- El README tiene el detalle de cada fase y cómo probarla; `docs/registro-2026-11-06.md`, la última sesión y lo pendiente.

## Stack

- **Next.js 16.4** (App Router, Turbopack, React 19.3). Cambia respecto de versiones anteriores: leer `node_modules/next/dist/docs/` antes de tocar APIs. Ejemplo: el middleware ahora es `src/proxy.ts` (función `proxy`).
- TypeScript, Tailwind CSS 4 (loader en `next.config.ts`), zod 4 para validar todo input en el servidor.
- **Supabase**: Postgres + Auth + RLS. El esquema vive solo en `supabase/migrations/` (no hay ORM). `@supabase/ssr` para sesión por cookies.
- FullCalendar 7 (agenda), Resend (mails), Google Calendar (OAuth), Mercado Pago (seña, hoy oculta), WhatsApp Cloud API (opcional).
- Renderizado dinámico clásico: **sin** Cache Components ni ISR.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Desarrollo (http://localhost:3000) |
| `npm run build` / `npm start` | Build y servidor de producción |
| `npm run typecheck` | `next typegen` + `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run test:db` | 44 pruebas de migraciones y RLS con PGlite, **sin Docker** |
| `npm run db:start` / `db:reset` | Supabase local (necesita Docker Desktop encendido) |

Antes de dar algo por terminado: `test:db`, `typecheck`, `lint` y `build`.

Local en Windows: abrir Docker Desktop (`C:\Users\vtxal\AppData\Local\Programs\DockerDesktop\Docker Desktop.exe`), `npx supabase start` (si falla por timeout de salud, reintentar), `npm run dev`. Seed: `demo@turnos.test / demo1234` → `/n/estudio-luna`; `barbero@turnos.test` → `/n/peluqueria-caballeros`. Studio en :54323, Mailpit en :54324.

## Arquitectura (lo que no se ve a simple vista)

- **Tres capas de seguridad**: `src/proxy.ts` (sin sesión no entra a `/panel`, `/onboarding`, `/cuenta`) → layout y Server Actions verifican sesión y rol (`src/lib/auth.ts`: `requerirPanel`, `requerirDueno`, `sesionParaAccion`) → **RLS**, que es la que importa.
- Roles: **dueño** (todo su negocio, `negocio_id = mi_negocio_id()`) y **empleado** (solo su agenda, sus turnos y clientes).
- `anon` no tiene acceso a ninguna tabla. El portal público usa RPC `security definer` (`negocio_publico`, `horarios_libres`, `dias_disponibles`, `ver_turno`, `cancelar_turno_cliente`). `crear_reserva` **solo se llama desde el servidor** con la service role (`src/lib/supabase/admin.ts`): por eso `SUPABASE_SERVICE_ROLE_KEY` es obligatoria.
- Los permisos de tablas (`grant`) están en las migraciones porque los proyectos nuevos de Supabase no los dan.
- Anti-superposición: `EXCLUDE USING gist` por profesional en `turnos`. Candado por local para reservas simultáneas.
- Reglas de reserva online: email obligatorio, 1 turno por fecha por mail, máx. 3 futuros por local (mail o celular), con 3 inasistencias solo 1 a la vez (el dueño lo quita con "Quitar límite"). Cancelados no cuentan; el panel no tiene límites. Límite por IP (hash) en `src/lib/limites.ts`.
- Celulares normalizados (`normalizarTelefono` en TS y `normalizar_telefono` en SQL).
- Turno del cliente: `/t/[token]` (64 hex, `noindex`), con cancelación, `.ics` y pago.
- Secretos de terceros (tokens de Google y MP) cifrados AES-256-GCM con `INTEGRACIONES_CLAVE` en `integraciones_secretos` (solo accesible con service role).
- Tareas periódicas: **un solo endpoint** `GET /api/cron` con `Authorization: Bearer <CRON_SECRET>` (señas vencidas, recordatorios por mail y WhatsApp, sincronización con Google, limpieza). Hay que llamarlo cada hora desde afuera.
- Se usa `after()` para mandar mails y sincronizar con Google después de responder.
- Integraciones opcionales: si falta su variable, la función se oculta (`integracionesDisponibles()` en `src/lib/env.ts`).
- **Seña con Mercado Pago apagada**: `SENA_ACTIVA = false` en `src/lib/env.ts`. No se borró nada; se activa pasándolo a `true`.
- En Google, los eventos creados por la app llevan `extendedProperties.private.turniaTurnoId`. **No renombrar** esa clave: sirve para no importar los propios eventos como "ocupados".

## Estado (2026-11-11)

- Fases 1 a 6 y extras hechas, probadas en local. Versión preliminar commiteada.
- Objetivo: que un amigo peluquero masculino la pruebe en su local. Google Calendar puede quedar sin conectar.
- **Próximo paso: publicar en un VPS** (antes se pensaba en Vercel; `vercel.json` queda pero no se usa). El repo todavía no tiene remoto.
- Pendiente de decidir: dominio (sin él Resend no entrega mails a terceros), mail de contacto para `/privacidad`, revisión de textos legales.
- Pedidos del usuario para después de publicar: pulir la estética de la reserva y marca por negocio (logo, color, portada). No agregar otras funciones sin que lo pida.
- Bug conocido a resolver antes de que el local sume empleados: un empleado puede ver los datos de un cliente si conoce su celular. El resto de lo pendiente está en `docs/registro-2026-11-06.md`.

## Publicar en un VPS

Recomendado: **Next.js en el VPS + Supabase cloud** (plan gratuito, región São Paulo). Autohostear Supabase en el VPS es posible (Docker), pero suma Auth, SMTP, backups y actualizaciones a mantener; solo vale la pena si se quiere todo en una máquina.

### 1. Supabase cloud

1. Crear el proyecto. `npx supabase link --project-ref <ref>` y `npx supabase db push` (sube las migraciones; el seed **no**).
2. Comprobar en el SQL Editor: `select has_table_privilege('authenticated', 'public.perfiles', 'select');` → `true`.
3. Auth → URL Configuration: `Site URL = https://<dominio>` y redirect `https://<dominio>/**`.
4. Auth → Email Templates: en **Confirm signup** el link `{{ .SiteURL }}/auth/confirmar?token_hash={{ .TokenHash }}&type=email&next=/onboarding`; en **Reset password**, el mismo con `type=recovery&next=/cuenta/password`.
5. Auth → SMTP con Resend: `smtp.resend.com`, puerto 465, usuario `resend`, contraseña = API key. Sin esto el mail de Supabase solo llega a los miembros del proyecto. Sin dominio: desactivar la confirmación de mail para la primera prueba.
6. Backups: el plan gratuito no los tiene. `npx supabase db dump` (y `--data-only`) periódicamente.

### 2. El servidor

- Ubuntu LTS, **mínimo 1 GB de RAM + 2 GB de swap** (el `next build` consume bastante; con 2 GB va cómodo).
- Node.js 20+ (en local se usa 24). Instalar con nvm o NodeSource.
- Usuario sin root para la app, SSH con clave, firewall (`ufw`): solo 22, 80 y 443. El puerto 3000 **no** se abre: queda detrás del proxy.
- DNS: registro A del dominio apuntando a la IP del VPS.

### 3. Variables de entorno (`.env.production.local` en el servidor, nunca en git)

| Variable | Obligatoria | Nota |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | sí | URL del proyecto cloud |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | sí | anon / publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | sí | solo servidor; las reservas la usan |
| `NEXT_PUBLIC_SITE_URL` | sí | `https://<dominio>`, sin `/` final |
| `CRON_SECRET` | sí | string aleatorio largo |
| `NEXT_PUBLIC_CONTACTO_EMAIL` | recomendada | aparece en `/privacidad` |
| `RESEND_API_KEY`, `EMAIL_FROM` | si hay dominio | `EMAIL_FROM="Agenda2 <turnos@dominio>"`; sin ellas los mails van a la consola |
| `INTEGRACIONES_CLAVE` | para Google/MP | ≥32 caracteres; si se pierde, hay que reconectar todo |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | opcional | redirect autorizada: `https://<dominio>/api/google/callback` |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_PLANTILLA_*` | opcional | ver README |

Generar secretos: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.

Las `NEXT_PUBLIC_*` se fijan **al compilar**: si cambian, hay que volver a hacer `npm run build`.

### 4. Build y proceso

```bash
git clone <repo> && cd <repo>
npm ci
npm run build
npm start            # escucha en :3000
```

Mantenerlo vivo con **systemd** o **PM2** (`pm2 start npm --name agenda2 -- start` + `pm2 startup` + `pm2 save`). Con un solo proceso no hace falta `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` ni `deploymentId`; sí si algún día hay varias instancias.

Actualizar: `git pull && npm ci && npm run build && pm2 restart agenda2`. Si hay migraciones nuevas, `npx supabase db push` antes.

### 5. Reverse proxy con HTTPS

Nginx + certbot o Caddy (HTTPS automático). Cosas a respetar:

- **IP real del cliente**: `src/lib/limites.ts` toma el primer valor de `X-Forwarded-For`. El proxy tiene que **pisar** ese header, no agregarle valores, porque si no cualquiera evita el límite por IP inventándolo. En nginx: `proxy_set_header X-Forwarded-For $remote_addr;` y `proxy_set_header X-Real-IP $remote_addr;`. Caddy ya lo pisa por defecto.
- Pasar `Host` y `X-Forwarded-Proto` (`proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto $scheme;`).
- Para el streaming de `loading.tsx` en nginx: `proxy_buffering off;` (o `X-Accel-Buffering: no`).
- `client_max_body_size` chico alcanza (no hay subida de archivos todavía).

Caddyfile mínimo:

```
dominio.com.ar {
    reverse_proxy 127.0.0.1:3000
}
```

### 6. Cron

En el crontab del VPS (cada hora):

```
0 * * * * curl -fsS -H "Authorization: Bearer <CRON_SECRET>" https://<dominio>/api/cron > /dev/null
```

### 7. Después de publicar

Prueba completa antes de pasársela al peluquero: registro con mail real, onboarding, servicios y horarios, reserva desde un celular real, mail de confirmación, cancelación desde `/t/[token]`, recordatorio (forzar con el cron), recuperar contraseña e invitar un empleado.
