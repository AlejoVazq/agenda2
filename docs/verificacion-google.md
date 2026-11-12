# Verificación de Google (Google Calendar)

Agenda2 pide un permiso **sensible** de Google Calendar, así que para que cualquier negocio lo pueda conectar (y sin que se corte cada 7 días) hay que pasar la *sensitive scope verification* de Google. Suele tardar entre 3 y 5 días hábiles si todo está en orden.

Requisitos (fuente: [Sensitive scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification) y [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)):

| Requisito de Google | Cómo lo cumple Agenda2 |
| --- | --- |
| Página de inicio en un dominio verificado, que explique la app (no solo un login) y enlace la política de privacidad | https://agenda2.tech, sección "Tu agenda también en Google Calendar" (`#google-calendar`) y link a Privacidad en el pie |
| Política de privacidad en el mismo dominio, la misma que figura en la pantalla de consentimiento, que diga cómo se accede, usa, guarda y comparte la información de Google | https://agenda2.tech/privacidad, sección "Datos de Google" (`#google`) |
| Declaración de Limited Use | En la misma sección, en español y en inglés |
| Aviso en el producto, en contexto | Panel → Integraciones: "Qué permiso le pedimos a Google", antes del botón "Conectar" |
| Pedir el permiso más acotado posible y explicar por qué uno más chico no alcanza | `calendar.events.owned` + `openid` + `email` (ver justificación abajo) |
| No transferir, vender ni usar los datos para publicidad | No se hace; lo dice la política |
| Datos seguros en tránsito y guardados | HTTPS; el permiso de Google se guarda cifrado (AES-256-GCM) en una tabla que solo lee el rol del servidor |
| Video que muestre el flujo completo, la pantalla de consentimiento en inglés con los permisos exactos y el uso de cada permiso | Guion abajo |
| Ser dueño de los dominios autorizados | Verificar `agenda2.tech` en Search Console (paso 1) |

## Qué hace la app con Google (para tenerlo a mano)

- **Permisos que pide** (`src/lib/google.ts`):
  - `openid`, `email`: solo para mostrar qué cuenta se conectó.
  - `https://www.googleapis.com/auth/calendar.events.owned`: "See, create, change, and delete events on Google calendars you own".
- **Calendario:** siempre el principal de la cuenta (`primary`), que es del usuario.
- **Escribe:** un evento por turno (servicio, cliente y su contacto). Se crea, se actualiza y se borra con el turno.
- **Lee:** de los eventos de ese calendario solo `id`, `start`, `end`, `status`, `transparency` y la respuesta del propio usuario (`attendees(self,responseStatus)`), para saber cuándo está ocupado. El `id` sirve para saltear los eventos que creó Agenda2 (`tn` + id del turno). Nunca títulos, descripciones, lugares ni invitados. Se guarda solo inicio y fin como "ausencia".
- **Desconectar:** borra los eventos futuros creados, las ausencias importadas y el permiso cifrado, y llama a `oauth2.googleapis.com/revoke`.
- **Si Google corta el acceso** (lo quitó el usuario o venció): la integración pasa a "Reconectar" y sale un mail al profesional y al dueño.

## 1. Verificar el dominio (Search Console)

1. Entrá a https://search.google.com/search-console con la **misma cuenta de Google** que va a ser dueña del proyecto de Google Cloud.
2. "Agregar propiedad" → **Dominio** → `agenda2.tech`.
3. Google te da un registro **TXT** (`google-site-verification=...`). En Hostinger: Dominios → `agenda2.tech` → DNS → agregar registro TXT, nombre `@`, valor el que te dio Google.
4. Volvé a Search Console y tocá "Verificar" (puede tardar unos minutos en propagarse).

## 2. Proyecto y pantalla de consentimiento (Google Cloud)

En https://console.cloud.google.com, con la misma cuenta:

1. Crear proyecto **Agenda2**.
2. APIs y servicios → Biblioteca → **Google Calendar API** → Habilitar.
3. Google Auth Platform (o "Pantalla de consentimiento de OAuth"):

| Campo | Valor |
| --- | --- |
| Tipo de usuario | Externo |
| Nombre de la app | Agenda2 |
| Mail de asistencia | vaztechcontact@gmail.com |
| Logo | **Dejarlo vacío** por ahora (subir logo suma una revisión de marca y demora) |
| Página principal | https://agenda2.tech |
| Política de privacidad | https://agenda2.tech/privacidad |
| Condiciones del servicio | https://agenda2.tech/terminos |
| Dominios autorizados | agenda2.tech |
| Contacto del desarrollador | vaztechcontact@gmail.com |
| Permisos (Acceso a datos → Agregar permisos) | `openid`, `.../auth/userinfo.email`, `.../auth/calendar.events.owned` (escribirlo en "Agregar permisos manualmente" si no aparece en la lista). **Ninguno más**: tienen que coincidir exactamente con los que pide la app |
| Usuarios de prueba (mientras esté en prueba) | Tu Gmail y el del peluquero |

4. Credenciales → Crear credenciales → **ID de cliente de OAuth** → Aplicación web:
   - Nombre: Agenda2 web.
   - URI de redireccionamiento autorizado: `https://agenda2.tech/api/google/callback`.
5. Copiar el ID y el secreto a `/srv/agenda2/web/.env.production.local` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) y `systemctl restart agenda2-web`. No hace falta compilar de nuevo.

Con esto ya funciona en **modo prueba** para los usuarios de prueba (Google corta el acceso cada 7 días; la app avisa por mail para reconectar).

## 3. Justificación del permiso (pegar en el formulario, en inglés)

> **https://www.googleapis.com/auth/calendar.events.owned**
>
> Agenda2 is an online booking tool for hair salons, barbershops and beauty businesses. Each professional can optionally connect their own Google Calendar from Panel → Integrations. We use this scope for two user-facing features, only on the user's primary calendar:
>
> 1. Create, update and delete one event per appointment, so the professional sees their bookings in Google Calendar. When an appointment is rescheduled or cancelled in Agenda2, the event is updated or deleted.
> 2. Read only the id, status, start time, end time, transparency (busy/free) and the user's own response status of the events in that calendar, so we don't offer those busy time slots to customers booking online. We never read or store event titles, descriptions, locations or attendees (we request only those fields with the `fields` parameter).
>
> Narrower scopes don't work: `calendar.events.owned.readonly` and `calendar.freebusy` are read-only and cannot create the appointment events; `calendar.app.created` only gives access to calendars created by the app, so we could not see when the professional is busy in their own calendar. `calendar.events.owned` is narrower than `calendar.events` because it is limited to calendars the user owns.
>
> Google user data is not sold, transferred to third parties, used for advertising or used to train AI models. Tokens are stored encrypted (AES-256-GCM). Disconnecting deletes the created future events, the imported busy times and the token, and revokes access.

Para `openid` y `email` (no sensibles), si piden explicación: *"Used only to show the user which Google account is connected."*

## 4. Guion del video (YouTube, "No listado")

Antes de grabar: navegador en inglés o agregar `&hl=en` a la URL de la pantalla de Google para que el consentimiento salga **en inglés**; una cuenta de prueba con un turno de mañana libre; Google Calendar abierto en otra pestaña. Duración: 2 a 4 minutos. Se puede narrar en inglés o poner subtítulos.

1. **Inicio:** mostrar https://agenda2.tech y bajar hasta "Tu agenda también en Google Calendar"; abrir el link a la política y mostrar la sección "Datos de Google".
2. **Login:** entrar al panel con un usuario de negocio.
3. **Aviso en contexto:** Panel → Integraciones; mostrar el recuadro "Qué permiso le pedimos a Google".
4. **OAuth:** tocar "Conectar". En la pantalla de Google, **mostrar la barra de direcciones** (que se vea `client_id=...`), elegir la cuenta y mostrar la pantalla de permisos completa con el permiso de calendario. Aceptar.
5. **Vuelve conectado:** mostrar "Conectado" con el mail de la cuenta.
6. **Uso 1 (escribir):** abrir la página pública del negocio (`/n/<slug>`), reservar un turno y mostrar que aparece en Google Calendar. Después cancelarlo o moverlo desde el panel y mostrar que el evento cambia o desaparece.
7. **Uso 2 (leer ocupados):** en Google Calendar crear un evento "ocupado" en un horario; en Integraciones tocar "Sincronizar ahora"; mostrar en la página pública que ese horario ya no se ofrece.
8. **Desconectar:** en Integraciones tocar "Desconectar" y mostrar que los eventos futuros creados por Agenda2 desaparecen del calendario.

## 5. Pedir la verificación

1. Google Auth Platform → Público → **Publicar app** (pasa de "Prueba" a "En producción").
2. Centro de verificación → completar la justificación (paso 3), pegar el link del video (paso 4) y enviar.
3. Contestar rápido los mails de Google (llegan a vaztechcontact@gmail.com): si no se responde, pueden cortar el acceso.

## Si algo cambia

Si la app empieza a usar otros datos de Google, hay que actualizar a la vez `src/lib/google.ts`, la sección "Datos de Google" de `/privacidad`, el aviso de Integraciones, los permisos de la pantalla de consentimiento y volver a pedir la verificación.
