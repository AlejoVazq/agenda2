# Google Calendar: qué falta para activarlo

Checklist para conectar Agenda2 con Google Calendar y pasar la verificación de Google. El porqué de cada requisito y lo que hace la app con los datos está en `verificacion-google.md`; acá va solo **qué hacer y en qué orden**.

Estado al 2026-11-17:

- [x] La web cumple lo que pide Google: portada con la sección "Tu agenda también en Google Calendar", `/privacidad#google` (con Limited Use), `/terminos`, aviso en Panel → Integraciones, permiso mínimo.
- [x] `INTEGRACIONES_CLAVE` cargada en el servidor (cifra los permisos de Google).
- [x] Registro TXT `google-site-verification=...` cargado en Hostinger. Ya se ve desde los DNS de Google (8.8.8.8).
- [x] Dominio **verificado** en Search Console (2026-11-17).
- [ ] Proyecto de Google Cloud, pantalla de consentimiento y credenciales → paso 2. **Frenado el 2026-11-17**: problema con la verificación en 2 pasos de la cuenta de Google al entrar a Cloud Console. Resolver eso primero (myaccount.google.com → Seguridad) y retomar desde acá.
- [ ] `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` en el servidor → paso 3.
- [ ] Prueba con tu cuenta y la del peluquero → paso 4.
- [ ] Video para Google → paso 5.
- [ ] Publicar la app y pedir la verificación → paso 6.

> Usá **siempre la misma cuenta de Google** en Search Console y en Google Cloud. Google chequea que el dueño del proyecto sea dueño del dominio.

---

## 1. Terminar de verificar el dominio (Search Console)

El TXT ya está publicado; falta que Search Console lo confirme.

1. Entrá a https://search.google.com/search-console.
2. Abrí la propiedad `agenda2.tech` (tipo **Dominio**) y tocá **Verificar**.
3. Si dice que no lo encuentra, esperá entre 15 minutos y unas horas y volvé a probar: algunos DNS tardan más en enterarse. No borres ni dupliques el registro.
4. Listo cuando la propiedad aparece en la lista sin el cartel de "no verificada".

Comprobar el TXT desde la PC (PowerShell):

```powershell
Resolve-DnsName agenda2.tech -Type TXT -Server 8.8.8.8
```

## 2. Proyecto en Google Cloud

En https://console.cloud.google.com, con la misma cuenta:

### 2.1 Proyecto y API

1. Arriba, selector de proyectos → **Proyecto nuevo** → nombre `Agenda2` → Crear. Dejalo seleccionado.
2. Menú → **APIs y servicios → Biblioteca** → buscar **Google Calendar API** → **Habilitar**.

### 2.2 Pantalla de consentimiento (Google Auth Platform)

Menú → **Google Auth Platform** (en algunas cuentas figura como "Pantalla de consentimiento de OAuth") → Comenzar.

| Sección / campo | Valor |
| --- | --- |
| Nombre de la app | `Agenda2` |
| Mail de asistencia al usuario | `vaztechcontact@gmail.com` |
| Público / tipo de usuario | **Externo** |
| Información de contacto (desarrollador) | `vaztechcontact@gmail.com` |
| **Desarrollo de la marca** → Logo | **Vacío** (subir logo suma otra revisión y demora) |
| Página principal de la app | `https://agenda2.tech` |
| Política de privacidad | `https://agenda2.tech/privacidad` |
| Condiciones del servicio | `https://agenda2.tech/terminos` |
| Dominios autorizados | `agenda2.tech` |

**Acceso a los datos → Agregar o quitar permisos.** Tienen que ser **exactamente** estos tres, ni uno más:

- `openid`
- `.../auth/userinfo.email`
- `https://www.googleapis.com/auth/calendar.events.owned` (si no aparece en la lista, pegarlo en "Agregar permisos manualmente")

**Público → Usuarios de prueba → Agregar usuarios:** tu Gmail y el Gmail del peluquero (hasta 100). Mientras la app esté "En prueba", solo ellos pueden conectar.

### 2.3 Credenciales (ID de cliente)

**Google Auth Platform → Clientes** (o APIs y servicios → Credenciales → Crear credenciales → ID de cliente de OAuth):

| Campo | Valor |
| --- | --- |
| Tipo de aplicación | **Aplicación web** |
| Nombre | `Agenda2 web` |
| Orígenes autorizados de JavaScript | (vacío, no hace falta) |
| URI de redireccionamiento autorizados | `https://agenda2.tech/api/google/callback` (exacto, sin `/` al final) |

Al crearlo, Google muestra el **ID de cliente** (termina en `.apps.googleusercontent.com`) y el **secreto** (empieza con `GOCSPX-`). Descargá el JSON o copiá los dos: el secreto después ya no se vuelve a mostrar entero.

## 3. Cargar las credenciales en el servidor (lo hace Claude)

Pasale el ID y el secreto a Claude. No los pegues en el repo ni en un commit.

Claude los agrega a `/srv/agenda2/web/.env.production.local`:

```
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
```

y reinicia con `systemctl restart agenda2-web`. No hace falta compilar de nuevo (no son `NEXT_PUBLIC_*`).

Desde ahí, en **Panel → Integraciones** aparece el botón "Conectar" de Google Calendar.

## 4. Probarlo (modo prueba)

Con una cuenta que esté en "Usuarios de prueba":

1. Panel → Integraciones → **Conectar**. Google avisa "Google no verificó esta app": **Avanzado → Ir a Agenda2**. Es normal mientras no esté verificada.
2. Aceptar el permiso del calendario. Vuelve a Integraciones con "Conectado" y el mail.
3. Reservar un turno desde `/n/<tu-negocio>` → tiene que aparecer en Google Calendar.
4. Cancelarlo o moverlo desde el panel → el evento cambia o desaparece.
5. Crear en Google Calendar un evento "ocupado" → Integraciones → "Sincronizar ahora" → ese horario ya no se ofrece en la página pública.
6. Desconectar → desaparecen los eventos futuros creados por Agenda2.

Limitación del modo prueba: **Google corta el acceso cada 7 días**. La app manda un mail para reconectar. Para que no pase más hay que verificar (pasos 5 y 6).

Si algo falla, anotar el mensaje exacto (`redirect_uri_mismatch`, `access_denied`, etc.) y pasárselo a Claude.

## 5. Grabar el video para Google

YouTube, visibilidad **No listado**, de 2 a 4 minutos. La pantalla de permisos de Google tiene que salir **en inglés**: navegador en inglés o agregar `&hl=en` al final de la URL de Google antes de aceptar. Se puede narrar en inglés o poner subtítulos en inglés.

Preparar antes: una cuenta de prueba, un negocio con un horario libre mañana y Google Calendar abierto en otra pestaña.

1. **Inicio:** `https://agenda2.tech`, bajar hasta "Tu agenda también en Google Calendar"; abrir Privacidad y mostrar "Datos de Google".
2. **Login** al panel.
3. **Aviso:** Panel → Integraciones, mostrar el recuadro "Qué permiso le pedimos a Google".
4. **OAuth:** tocar "Conectar". En Google, **mostrar la barra de direcciones** (que se lea `client_id=...`), elegir la cuenta y mostrar la pantalla de permisos completa. Aceptar.
5. **Conectado:** mostrar el estado con el mail.
6. **Uso 1 (escribir):** reservar un turno en la página pública y mostrarlo en Google Calendar; después cancelarlo o moverlo y mostrar el cambio.
7. **Uso 2 (leer ocupados):** crear un evento ocupado en Google Calendar, "Sincronizar ahora" y mostrar que ese horario ya no se ofrece.
8. **Desconectar** y mostrar que los eventos futuros desaparecen.

## 6. Publicar y pedir la verificación

1. **Google Auth Platform → Público → Publicar app** (de "Prueba" a "En producción").
2. **Centro de verificación** → completar:
   - Justificación del permiso `calendar.events.owned`: copiar el texto en inglés de `verificacion-google.md`, sección 3.
   - Para `openid` y `email`, si piden: *"Used only to show the user which Google account is connected."*
   - Link del video del paso 5.
3. Enviar. Suele tardar **3 a 5 días hábiles**.
4. Revisar `vaztechcontact@gmail.com` (y spam) y contestar rápido: si Google pregunta algo y no se responde, pueden frenar la revisión.

Mientras se revisa, el modo prueba sigue andando para los usuarios de prueba.

## Si Google pide cambios

Si piden cambiar textos de la web, la política o el aviso, decirle a Claude qué pidieron (copiar el mail). Si la app empieza a usar otros datos de Google, hay que actualizar a la vez `src/lib/google.ts`, `/privacidad#google`, el aviso de Integraciones, los permisos de la pantalla de consentimiento y volver a pedir la verificación.
