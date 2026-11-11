-- =============================================================================
-- Roles y base de Agenda2. Se corre UNA vez, como superusuario (postgres):
--
--   sudo -u postgres psql -v ON_ERROR_STOP=1 \
--     -v clave_dueno='...' -v clave_app='...' -f db/roles.sql
--
-- En desarrollo y en las pruebas lo corre scripts/db-local.mjs / test-db.mjs,
-- reemplazando las variables :'clave_dueno' y :'clave_app'.
--
-- Los roles son de todo el servidor de Postgres (no de una base): por eso
-- llevan el prefijo agenda2_, para no chocar con otros proyectos (EnSushi).
--
--   agenda2_dueno     LOGIN. Dueño de la base, los esquemas, las tablas y las
--                     funciones security definer. Solo lo usan las migraciones.
--   agenda2_app       LOGIN, NOINHERIT. Con el que se conecta la app. Por sí solo
--                     no puede leer nada: cada consulta hace SET LOCAL ROLE a uno
--                     de los cuatro de abajo. Si una consulta se escapa sin cambiar
--                     de rol, falla con "permission denied" (falla cerrado).
--   agenda2_usuario   Usuario del panel (dueño o empleado). Todo pasa por RLS.
--   agenda2_anonimo   Visitante del portal público. Solo ejecuta las funciones
--                     públicas; no puede tocar ninguna tabla.
--   agenda2_servidor  Tareas del servidor (reservas, cron, integraciones).
--                     Saltea RLS, pero no lee contraseñas ni sesiones.
--   agenda2_auth      Better Auth. Solo ve el esquema auth.
-- =============================================================================

create role agenda2_dueno login password :'clave_dueno';
create role agenda2_app login noinherit password :'clave_app';

create role agenda2_usuario nologin;
create role agenda2_anonimo nologin;
create role agenda2_servidor nologin bypassrls;
create role agenda2_auth nologin;

-- agenda2_app puede cambiar a cada uno (SET ROLE), pero no hereda sus permisos.
grant agenda2_usuario, agenda2_anonimo, agenda2_servidor, agenda2_auth
  to agenda2_app with inherit false, set true;

-- Límites de seguridad: ninguna consulta de la app se queda colgada.
alter role agenda2_app set statement_timeout = '15s';
alter role agenda2_app set idle_in_transaction_session_timeout = '30s';

-- @base (desde acá, la base; las pruebas con PGlite usan solo lo de arriba)

-- Orden alfabético en español (Álvaro, Ana, ángel, ..., Ñandú, Zoe).
create database agenda2 owner agenda2_dueno encoding 'UTF8' template template0
  locale_provider icu icu_locale 'es-AR' locale 'C';

-- Nadie más se conecta a esta base.
revoke connect, temporary on database agenda2 from public;
grant connect on database agenda2 to agenda2_dueno, agenda2_app;
