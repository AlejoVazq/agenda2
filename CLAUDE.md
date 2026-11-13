@AGENTS.md

# Agenda2

App de agenda y reservas online de turnos para negocios de servicios en Argentina (peluquería masculina/femenina, barbería, uñas, estética). El cliente reserva desde el celular sin crear cuenta (`/n/[slug]`) y el negocio gestiona todo desde `/panel`. Antes se llamó "Turnia": el nombre visible está solo en `src/lib/marca.ts`.

- Todo en **español es-AR**: código, nombres de archivos, variables, textos y commits.
- Fechas en UTC (`timestamptz`), se muestran en `America/Argentina/Buenos_Aires` (helpers en `src/lib/fechas.ts`, usa `temporal-polyfill`).
- El README tiene el detalle de cada fase y cómo probarla; `docs/registro-2026-11-11.md`, la última sesión (salida de Supabase) y lo pendiente.

## Stack

- **Next.js 16.4** (App Router, Turbopack, React 19.3). Cambia respecto de versiones anteriores: leer `node_modules/next/dist/docs/` antes de tocar APIs. Ejemplo: el middleware ahora es `src/proxy.ts` (función `proxy`, corre en Node.js).
- TypeScript, Tailwind CSS 4 (loader en `next.config.ts`), zod 4 para validar todo input en el servidor.
- **PostgreSQL 18 propio** (en el VPS), con **node-postgres (`pg`) sin ORM**. El esquema vive solo en `db/migraciones/` (SQL puro).
- **Better Auth 1.7** para cuentas y sesiones (sus tablas en el esquema `auth` de la misma base).
- FullCalendar 7 (agenda), Resend (mails), Google Calendar (OAuth), Mercado Pago (seña, hoy oculta), WhatsApp Cloud API (opcional).
- Renderizado dinámico clásico: **sin** Cache Components ni ISR.
- No se usa Supabase (ni cloud ni autohosteado): decisión del 2026-11-11.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run db:local` | Postgres 18 local embebido en `.pgdata/` (sin Docker). La primera vez crea roles, base, tablas y seed. Queda en primer plano |
| `npm run dev` | Desarrollo (http://localhost:3000) |
| `npm run build` / `npm start` | Build y servidor de producción |
| `npm run typecheck` | `next typegen` + `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run test:db` | 67 pruebas de migraciones, roles, RLS, suscripciones y admin con PGlite |
| `npm run db:migrar` | Aplica migraciones pendientes (usa `DATABASE_URL_MIGRAR`) |
| `npm run db:seed` / `db:reset` | Datos demo / borrar todo y volver a migrar + seed (solo contra una base local) |
| `npm run admin -- agregar <mail>` | Hace admin de la plataforma a una cuenta (también `listar`, `quitar`, `quitar-2fa`). Usa `DATABASE_URL_MIGRAR` |

Antes de dar algo por terminado: `test:db`, `typecheck`, `lint` y `build`.

Local: `npm run db:local` en una terminal y `npm run dev` en otra. Variables en `.env.development.local` (o `.env.local`), ver `.env.example`. Sin `RESEND_API_KEY` los mails salen enteros en la consola de `npm run dev` (ahí están los links de verificación y de recuperación). Seed: `demo@turnos.test / demo1234` → `/n/estudio-luna`; `barbero@turnos.test / demo1234` → `/n/peluqueria-caballeros`; `admin@turnos.test / demo1234` → `/admin` (pide configurar el segundo factor).

## Arquitectura (lo que no se ve a simple vista)

- **Tres capas de seguridad**: `src/proxy.ts` (valida la sesión contra la base en `/panel` y `/onboarding`) → layout y Server Actions verifican sesión y rol (`src/lib/auth.ts`: `requerirPanel`, `requerirDueno`, `sesionParaAccion`) → **RLS**, que es la que importa.
- **Roles de Postgres** (`db/roles.sql`, prefijo `agenda2_` porque los roles son de todo el servidor):
  - `agenda2_dueno`: dueño de la base, esquemas, tablas y funciones `security definer`. Solo para migraciones.
  - `agenda2_app`: con el que se conecta la app (`DATABASE_URL`). **NOINHERIT**: por sí solo no puede leer nada; si una consulta no cambia de rol, falla (falla cerrado).
  - `agenda2_usuario` (panel, con RLS), `agenda2_anonimo` (portal público: solo 5 funciones, ninguna tabla), `agenda2_servidor` (BYPASSRLS, reservas/cron/integraciones; no lee contraseñas ni sesiones), `agenda2_auth` (Better Auth, solo el esquema `auth`).
- **Capa de datos** (`src/lib/db`): `comoUsuario(id, tx => …)`, `comoAnonimo(…)`, `comoServidor(…)`. Cada una abre una transacción con `SET LOCAL ROLE` y, para el panel, `set_config('app.usuario_id', id, true)`. `app.usuario_id()` reemplaza a `auth.uid()`. Consultas siempre con la plantilla `` sql`…${valor}…` `` (parámetros, nunca concatenado). Los tipos vuelven como antes con PostgREST: timestamptz en ISO con microsegundos, numeric como number.
- **Sesión** (`src/lib/better-auth.ts`): registro con verificación de mail obligatoria, login, recuperar contraseña, cookie httpOnly (prefijo `agenda2`, `Secure` en producción). Las pantallas usan Server Actions con zod y límite por IP que llaman a `auth.api.*`; por `/api/auth` solo pasan los links de los mails (`verify-email`, `reset-password/*`), el resto está cerrado. Login con Google: comentado en `better-auth.ts`, fácil de sumar.
- **Accesos del equipo** (`src/lib/accesos.ts`, tabla `accesos`): el dueño crea el usuario del empleado y le pasa a mano un link de un solo uso `/acceso/[token]` (24 h, se guarda solo el hash) para elegir la contraseña; el mismo mecanismo sirve si la olvida.
- Roles del panel: **dueño** (todo su negocio, `negocio_id = mi_negocio_id()`) y **empleado** (solo su agenda y sus turnos). **Un empleado no lee fichas de clientes**: de sus turnos ve los datos con que se pidieron (`nombre_reserva`, `email_reserva`, `telefono_reserva`). Los avisos al cliente se leen con el rol del servidor.
- El portal público usa funciones `security definer` (`negocio_publico`, `horarios_libres`, `dias_disponibles`, `ver_turno`, `cancelar_turno_cliente`). `crear_reserva` **solo la ejecuta el servidor** (`comoServidor`), así no se esquiva el límite por IP.
- Migraciones (`db/migrar.mjs`): tabla `app.schema_version` con checksum; **nunca se edita una migración aplicada**, se crea una nueva `NNNN_nombre.sql`. Cada una corre en su transacción, con candado.
- Ninguna función nueva queda ejecutable por `public` (`alter default privileges` en la migración 0001): cada permiso se da explícito. `test:db` verifica que el anónimo ejecute solo las 5 públicas.
- Anti-superposición: `EXCLUDE USING gist` por profesional en `turnos`. Candado por local para reservas simultáneas.
- Reglas de reserva online: email obligatorio, 1 turno por fecha por mail, máx. 3 futuros por local (mail o celular), con 3 inasistencias solo 1 a la vez (el dueño lo quita con "Quitar límite"). Cancelados no cuentan; el panel no tiene límites. Los límites comparan el mail con `public.clave_email` (sin `+etiqueta`; en Gmail, sin puntos). Cancelar online: hasta el plazo del negocio o, si es más tarde, dentro de los 15 minutos de haber reservado (`public.cancelable_hasta`). Límite por IP (hash) en `src/lib/limites.ts`.
- Celulares normalizados (`normalizarTelefono` en TS y `normalizar_telefono` en SQL).
- Turno del cliente: `/t/[token]` (64 hex, `noindex`), con cancelación, `.ics` y pago.
- Secretos de terceros (tokens de Google y MP) cifrados AES-256-GCM con `INTEGRACIONES_CLAVE` en `integraciones_secretos` (solo el rol del servidor).
- Tareas periódicas: **un solo endpoint** `GET /api/cron` con `Authorization: Bearer <CRON_SECRET>` (señas vencidas, recordatorios por mail y WhatsApp, sincronización con Google, limpieza de límites y links vencidos). En el servidor lo llama `deploy/agenda2-cron.timer` cada hora.
- Se usa `after()` para mandar mails y sincronizar con Google después de responder.
- Integraciones opcionales: si falta su variable, la función se oculta (`integracionesDisponibles()` en `src/lib/env.ts`).
- **Suscripciones** (migraciones 0002 y 0007, `src/lib/suscripcion.ts`): plan mensual, pagos registrados a mano desde `/admin`. El estado **se calcula** con `prueba_hasta` (7 días desde el alta), `pagado_hasta` y `suspendido_at` (`plataforma.estado_suscripcion`). Etapas (decididas por el usuario el 2026-11-13):
  - **prueba / activa**: todo funciona. Mail de aviso 4 días antes de vencer en el plan (día 26 de 30) y 2 días antes en la prueba.
  - **gracia** (5 días desde que vence): panel en **solo lectura**, pero la página **sigue tomando reservas**.
  - **vencida = apagada**: no se entra al panel (`requerirPanel` redirige a `/pausado`) y la página no toma reservas. Los datos quedan; si paga, vuelve todo.
  - **suspendida = "dada de baja"** por el admin: igual que apagada, sin importar lo pagado. Se puede reactivar.
  - En la base: `plataforma.negocio_habilitado` (escrituras del panel: prueba/activa) y `plataforma.negocio_toma_reservas` (turnos online: prueba/activa/gracia), aplicados por el trigger `plataforma.tg_exigir_habilitado` (`NEGOCIO_NO_HABILITADO`). Siguen andando la cancelación del cliente, el cron y el admin. Las acciones que escriben con el rol del servidor chequean `sesion.habilitado`. El dueño no puede cambiar esas columnas. El cron manda los mails `por_vencer`, `vencio` y `bloqueado` (apagado) con `plataforma.reclamar_avisos_suscripcion`.
- **Panel de la plataforma `/admin`** (`src/lib/admin.ts`, `src/app/admin`): lista de negocios, detalle (suscripción, pagos, configuración en solo lectura, contacto, notas, historial) y acciones (registrar/anular pago, extender prueba, dar de baja/reactivar, cambiar dirección, link de contraseña para el dueño, reenviar verificación, **eliminar**). El detalle muestra la línea de tiempo de la membresía (día X de N, aviso, vencimiento, gracia, apagado; `src/app/admin/membresia.tsx`). **Eliminar** (`plataforma.admin_eliminar`, 0007): casillas para borrar el negocio con todos sus datos y/o las cuentas del dueño y su equipo; pide el nombre exacto, nunca borra un admin y deja un resumen en la auditoría, que `/admin` lista en "Eliminados". **Aviso por WhatsApp al dueño** (`src/app/admin/aviso-whatsapp.ts`): en la lista y en el detalle, si está por vencer (≤ 7 días), en gracia, apagado o dado de baja, un botón abre `wa.me` al teléfono del negocio con el mensaje de esa etapa ya escrito; lo manda el admin a mano y queda `aviso_whatsapp` en el historial. Automático no: haría falta una plantilla aprobada de WhatsApp Cloud API. **Nunca muestra clientes, turnos uno por uno ni precios.** Esquema `plataforma` (administradores, pagos, notas, auditoría, últimos ingresos) sin grants a la app: todo pasa por funciones `plataforma.admin_*` que verifican en la base que `app.usuario_id()` sea admin y dejan auditoría. A quien no es admin, `/admin` le da 404. **Segundo factor (TOTP, plugin `twoFactor` de Better Auth) obligatorio** para los admins; el login pide el código en `/login/codigo`. Los admins se agregan solo desde el servidor (`npm run admin -- agregar`) y conviene que sean cuentas sin negocio.
- **Identidad visual** (2026-11-12, rama `identidad-visual`): paleta verde pino y hueso. Tokens en `src/app/globals.css` (`marca-*` verde pino, `acento-*` naranja quemado, `arena`, `zinc-*` reemplazado por neutros cálidos tipo papel, `fondo`, `tinta`, `noche`; sombras `shadow-suave`/`shadow-flotante`; animaciones `animate-aparecer`, `retraso-N`). Títulos con Bricolage Grotesque (`font-display`, aplicado a h1-h3 en la capa base), texto con Plus Jakarta Sans. Isotipo = una A con el 2 entrelazado (la base del 2 es la barra de la A): trazos en `src/lib/isotipo.ts`, usados por `Isotipo`/`Logo` (`src/components/ui.tsx`), `src/app/icon.svg` y las imágenes OG. Las maquetas de la landing están en `src/app/_inicio/`. Los mails usan los mismos colores en hex.
- **Logo de cada negocio** (migración 0006, `src/lib/logo.ts`): tabla `negocio_logos` (bytea, PNG/JPEG/WebP, máx. 512 KB, sin SVG); solo el rol del servidor la lee y escribe (las acciones de `/panel/negocio` verifican dueño y `sesion.habilitado`). El navegador la achica a 512 px antes de subirla. Se sirve en `/n/[slug]/logo?v=<versión>` (cache inmutable) y se muestra en el portal, el panel y la imagen OG del negocio.
- **Seña con Mercado Pago apagada**: `SENA_ACTIVA = false` en `src/lib/env.ts`. No se borró nada; se activa pasándolo a `true`.
- En Google, los eventos creados por la app tienen id fijo `tn` + id del turno sin guiones (`idEvento`): así se reconocen para no importarlos como "ocupados" (desde 2026-11-12 ya no se lee `extendedProperties`). **No cambiar ese formato de id.** También llevan `extendedProperties.private.turniaTurnoId`, solo como referencia.
- **Google Calendar y su verificación:** permiso `calendar.events.owned` (solo el calendario principal), se leen únicamente id/estado/inicio/fin/ocupado. Lo que se presenta a Google y por qué está en `docs/verificacion-google.md`; si cambia lo que se hace con datos de Google, actualizar a la vez `src/lib/google.ts`, `/privacidad#google`, el aviso de Integraciones y ese documento.

## Estado (2026-11-12)

- Fases 1 a 6 y extras hechas. Supabase reemplazado por Postgres propio + Better Auth (rama `sin-supabase`), probado en local de punta a punta.
- Objetivo: que un amigo peluquero masculino la pruebe en su local. Google Calendar puede quedar sin conectar.
- **Publicada en https://agenda2.tech** (VPS Hostinger `187.53.106.37`, SSH como `root`) desde el 2026-11-11. El repo está en GitHub (`AlejoVazq/agenda2`). `RESEND_API_KEY` cargada (clave de solo envío). Falta la prueba completa del paso 7.
- Mail de contacto de `/privacidad`: `vaztechcontact@gmail.com`.
- Publicado al 2026-11-12: migraciones 0001 a 0006 (suscripciones, `/admin` con admin ya cargado, identidad visual verde pino, logo por negocio) y el 404 real en `/n/[slug]` (082be58). El `revoke connect` en la base de EnSushi ya se hizo.
- En producción no hay todavía negocios reales: `pollobarber` es una prueba del usuario (no es el local del amigo). No tocar EnSushi. No agregar otras funciones sin que el usuario lo pida.

## Pendiente (rumbo, al 2026-11-12)

Ir en este orden salvo que el usuario diga otra cosa.

1. Borrar el negocio de prueba `pollobarber` desde `/admin` si el usuario quiere (la 0007 está publicada).
2. **Prueba completa del paso 7** (abajo) con mails reales; el recordatorio por mail nunca se probó de punta a punta.
3. **Revisión de textos legales** (`/privacidad`, `/terminos`) antes de sumar más locales.
4. **Detalles anotados el 2026-11-06**: resueltos el 2026-11-13 (migración 0008 y app): alias de mail (`public.clave_email`), aviso y "Quitar límite" de la ficha con la misma regla que la reserva, "+ Turno" desde la ficha con los datos del cliente, botón atrás en la reserva (`?paso=`), 90 días de anticipación (tope 92), estadísticas sin "$ 0" para servicios sin precio. Ya no pasaban: el link de confirmación (con Better Auth se puede abrir varias veces en 24 h) y el celular ya registrado (el turno usa `nombre_reserva`). **Quedan, a decidir con el usuario** (son funciones nuevas o reglas):
   - ~~el negocio no recibe aviso cuando un cliente cancela~~: hecho el 2026-11-13 (`notificarCancelacionCliente`, mail al dueño y al profesional de esa agenda);
   - ~~con menos de 2 h de anticipación no se puede cancelar online~~: hecho el 2026-11-13, 15 minutos para arrepentirse;
   - no hay botón para borrar un cliente.
5. **Ideas conversadas, sin hacer**: color propio y foto de portada por negocio (el logo ya está), tiempos de espera en servicios de peluquería (tintura), login con Google (comentado en `better-auth.ts`).
6. **Integraciones sin probar con cuentas reales**: Google Calendar (conectar y pasar la verificación, `docs/verificacion-google.md`), WhatsApp Cloud API (opcional), Mercado Pago (apagado a propósito con `SENA_ACTIVA`).
7. **Mantenimiento**: copiar los backups fuera del VPS cada tanto; borrar restos locales de Supabase (variables viejas en `.env.local`, carpeta `supabase/`, `agenda2-migracion-supabase.md` suelto en la raíz).

Historial de cada sesión en `docs/registro-*.md`.

## Publicar en el VPS

El servidor ya corre EnSushi con Postgres directo. Agenda2 va al lado: usuario Linux `agenda2`, código en `/srv/agenda2/web`, servicio `agenda2-web` en `127.0.0.1:3002`, base `agenda2` en el mismo PostgreSQL 18. Los archivos de systemd y Caddy están en `deploy/`.

### 1. Usuario y código (una vez)

```bash
sudo adduser --system --group --home /srv/agenda2 agenda2
sudo -u agenda2 git clone https://github.com/AlejoVazq/agenda2.git /srv/agenda2/web
```

Node 24 tiene que estar en `/usr/bin/node` (si no, ajustar `deploy/agenda2-web.service`). El servidor necesita **2 GB de RAM (o 1 GB + 2 GB de swap)** para el `next build`. Firewall: solo 22, 80 y 443; el 3002 no se abre.

### 2. Base de datos (una vez)

Generar dos contraseñas largas y crear roles y base como superusuario:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"   # dos veces
cd /srv/agenda2/web
sudo -u postgres psql -v ON_ERROR_STOP=1 -v clave_dueno='<clave1>' -v clave_app='<clave2>' -f db/roles.sql
```

`db/roles.sql` crea los roles `agenda2_*`, la base `agenda2` (orden alfabético en español, ICU `es-AR`) y le saca el `connect` a `public`. Conviene hacer lo mismo con la base de EnSushi (`revoke connect on database <base_ensushi> from public;`) para que ningún rol de un proyecto pueda entrar a la base del otro.

Comprobar: `sudo -u postgres psql -d agenda2 -c "select rolname, rolinherit, rolbypassrls from pg_roles where rolname like 'agenda2_%'"`.

### 3. Variables de entorno

`/srv/agenda2/web/.env.production.local` (chmod 600, dueño `agenda2`; nunca en git):

| Variable | Obligatoria | Nota |
| --- | --- | --- |
| `DATABASE_URL` | sí | `postgres://agenda2_app:<clave2>@127.0.0.1:5432/agenda2` |
| `BETTER_AUTH_SECRET` | sí | ≥32 caracteres al azar. Si cambia, se cierran todas las sesiones |
| `BETTER_AUTH_URL` | sí | `https://agenda2.tech` |
| `NEXT_PUBLIC_SITE_URL` | sí | `https://agenda2.tech`, sin `/` final |
| `CRON_SECRET` | sí | string al azar largo |
| `RESEND_API_KEY`, `EMAIL_FROM` | sí | `EMAIL_FROM="Agenda2 <turnos@agenda2.tech>"` (dominio verificado en Resend). Sin esto nadie puede confirmar su cuenta |
| `NEXT_PUBLIC_CONTACTO_EMAIL` | recomendada | aparece en `/privacidad` |
| `INTEGRACIONES_CLAVE` | para Google/MP | ≥32 caracteres; si se pierde, hay que reconectar todo |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | opcional | redirect autorizada: `https://agenda2.tech/api/google/callback` |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_PLANTILLA_*` | opcional | ver README |

`/srv/agenda2/web/.env.migrar.local` (chmod 600): solo `DATABASE_URL_MIGRAR=postgres://agenda2_dueno:<clave1>@127.0.0.1:5432/agenda2`. Va aparte para que el proceso de la app no tenga la conexión del dueño.

`/srv/agenda2/cron.env` (chmod 600): `CRON_SECRET=<el mismo>`.

Generar secretos: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Las `NEXT_PUBLIC_*` se fijan **al compilar**: si cambian, hay que volver a hacer `npm run build`.

### 4. Build, migraciones y servicio

```bash
cd /srv/agenda2/web
sudo -u agenda2 npm ci
sudo -u agenda2 npm run db:migrar      # crea las tablas (y aplica las nuevas en cada actualización)
sudo -u agenda2 npm run build
sudo cp deploy/agenda2-*.service deploy/agenda2-*.timer /etc/systemd/system/
sudo install -m 755 scripts/backup-db.sh /usr/local/bin/agenda2-backup-db
sudo mkdir -p /var/backups/agenda2 && sudo chown postgres:postgres /var/backups/agenda2 && sudo chmod 700 /var/backups/agenda2
sudo systemctl daemon-reload
sudo systemctl enable --now agenda2-web agenda2-cron.timer agenda2-backup.timer
```

El seed **no** se carga en producción. Con un solo proceso no hace falta `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` ni `deploymentId`; sí si algún día hay varias instancias.

Actualizar: `cd /srv/agenda2/web && sudo -u agenda2 git pull && sudo -u agenda2 npm ci && sudo -u agenda2 npm run db:migrar && sudo -u agenda2 npm run build && sudo systemctl restart agenda2-web`.

### 5. Caddy (HTTPS)

Copiar `deploy/Caddyfile` a `/etc/caddy/sitios/agenda2.caddy` (el Caddyfile global lo importa y define el snippet `comun`), `caddy validate --config /etc/caddy/Caddyfile` y `sudo systemctl reload caddy`. DNS: registro A de `agenda2.tech` (y `www`) a `187.53.106.37`.

- **IP real del cliente**: `src/lib/limites.ts` y Better Auth toman el primer valor de `X-Forwarded-For`. El bloque lo pisa con `header_up X-Forwarded-For {client_ip}`. El Caddyfile global solo confía en los rangos de Cloudflare (`trusted_proxies` + `CF-Connecting-IP`, puesto por EnSushi); **no sumar otros `trusted_proxies`**, o cualquiera esquiva el límite por IP inventando el header.
- `flush_interval -1` para el streaming de `loading.tsx`.

### 6. Cron y backups

- `agenda2-cron.timer`: cada hora llama a `http://127.0.0.1:3002/api/cron` con el secreto de `/srv/agenda2/cron.env`. Forzar una corrida: `sudo systemctl start agenda2-cron.service && journalctl -u agenda2-cron -n 5`.
- `agenda2-backup.timer`: `pg_dump` diario a `/var/backups/agenda2` (se guardan 14 días). Restaurar: ver `scripts/backup-db.sh`. Copiar los backups fuera del VPS cada tanto.

### 7. Después de publicar

Prueba completa antes de pasársela al peluquero: registro con mail real (llega el link de confirmación), onboarding, servicios y horarios, reserva desde un celular real, mail de confirmación, cancelación desde `/t/[token]`, recordatorio (forzar el cron con un turno de mañana reservado hace más de 3 h), recuperar contraseña e invitar un empleado y entrar como empleado.
