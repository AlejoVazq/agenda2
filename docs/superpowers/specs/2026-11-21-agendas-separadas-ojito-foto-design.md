# Agendas separadas por jerarquía, ojito en estadísticas y foto de profesionales

Aprobado por el usuario el 2026-11-21. Productos queda como idea (apartado en la reserva para sumar productos al servicio), sin hacer.

## Por qué

Con socios (migración 0010) cualquier dueño veía la agenda, los turnos y la facturación de todos. El usuario quiere una pirámide: el titular ve todo; un socio ve lo suyo y lo de los empleados, no lo del titular; un empleado, lo suyo. Además, tapar la plata de las estadísticas (cliente mirando la pantalla) y poder ponerle foto a cada profesional en el panel.

## Reglas

- **Titular** = el dueño más antiguo del negocio (como en `/panel/equipo`).
- `public.ve_agenda(negocio, profesional)`:
  - titular: todas las agendas de su negocio;
  - socio: la suya y las que no son de ningún dueño (empleados y profesionales sin usuario);
  - empleado: la suya.
- Se aplica en RLS: `turnos` (select/update), `turnos_fijos` (select), `bloqueos` (todo), `horarios_profesional` (escrituras: un socio no cambia el horario del titular), `integraciones` (un socio no conecta el Google del titular), y en las funciones `security definer` que escriben turnos (`crear_turno_panel`, `crear_turno_fijo`, `terminar_turno_fijo`).
- Estadísticas: la función ya es `security invoker`, así que se filtra sola por RLS. "Clientes nuevos" sin profesional elegido, para un no titular: solo fichas con algún turno que ve. El selector: titular → "Todo el negocio"; socio → "Lo mío y los empleados".
- Ficha de cliente: lista compartida; su historial muestra solo turnos visibles. El conteo de inasistencias y "Quitar límite" siguen siendo de todo el negocio (son la regla de reserva): pasan a `security definer` con chequeo de dueño.
- Sigue compartido: servicios, profesionales, página de reservas, Mi negocio, clientes. Reservas online y cron: sin cambios (rol del servidor).
- Los listados de profesionales del panel (agenda, turnos, ausencias, estadísticas, integraciones, "+ Turno") muestran solo agendas visibles.

## Ojito

Toda la plata de `/panel/estadisticas` arranca tapada ("$ •••••"); un botón con un ojo la muestra/tapa y se recuerda en el dispositivo (localStorage, con try/catch).

## Foto

Tabla `profesional_fotos` (como `negocio_logos`: bytea, PNG/JPEG/WebP, máx. 512 KB, solo el rol del servidor). La suben dueños/socios desde Profesionales → persona (el navegador la achica a 512 px). Se sirve en `/panel/profesionales/[id]/foto` solo a miembros del negocio. Se ve en el panel (Profesionales y Accesos); el portal sigue con iniciales.

## Enfoques

- Elegido: reglas en la base (RLS + función `ve_agenda`), como el resto de la seguridad.
- Descartado: filtrar solo en las pantallas; un socio vería lo del otro cambiando la URL.

## No objetivos

- Productos.
- Foto en la página de reservas.
- Separar clientes o servicios por socio.
