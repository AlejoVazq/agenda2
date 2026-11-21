# Precio y duración por profesional en cada servicio

Aprobado por el usuario el 2026-11-21.

## Por qué

Dos socios (o dos peluqueros) hacen el mismo servicio ("Corte") pero cobran distinto y pueden tardar distinto. Hoy el servicio tiene un solo precio y una sola duración, y quién lo hace se elige desde la ficha del profesional.

## Enfoques

- **A (elegido): servicio compartido con ajustes por profesional.** `profesional_servicio` suma `precio` y `duracion_min` opcionales; vacío = usa los del servicio. Se configura en la pantalla del servicio. No rompe turnos, turnos fijos ni estadísticas; "Cualquiera" sigue andando.
- B: cada profesional con sus propios servicios. Rompe "Cualquiera", parte las estadísticas y obliga a migrar datos reales. Descartado.

## Diseño

- Migración `0016`: columnas `precio numeric(12,2) >= 0` y `duracion_min integer 5..600` (nulas) en `profesional_servicio`; función `guardar_profesionales_servicio(servicio, filas jsonb)` (dueño, reemplaza las filas del servicio).
- Precio y duración efectivos = `coalesce(ps.x, s.x)`. Los usan: `horarios_libres` (duración por profesional), `crear_reserva` (fin, precio y seña del profesional asignado), `crear_turno_panel`, `crear_turno_fijo` y `generar_turnos_fijos`. Si el profesional no tiene el servicio asignado (el panel lo permite), usa los generales.
- `negocio_publico`: cada servicio suma `por_profesional` (`{id: {precio, duracion_min}}`, valores efectivos).
- Pantalla del servicio: lista "¿Quién lo hace?" con casilla, precio y duración por profesional (precargados con los generales; si son iguales a los generales se guardan vacíos, así siguen al general).
- Profesionales: se quita la lista de servicios (queda un resumen de solo lectura con link a cada servicio). Al crear un profesional se le asignan todos los servicios activos que no son de emergencia (mi decisión: es lo más común en una peluquería; se destilda en el servicio).
- Portal: con profesional elegido, precio y duración de ese profesional; con "Cualquiera" y valores distintos, "desde $X" y la duración más corta con "desde".
- "+ Turno" del panel: la duración que se muestra es la del profesional elegido.
- Turnos ya cargados no cambian.

## No objetivos

- Nombre o descripción distintos por profesional.
- Que un empleado edite sus propios precios (los edita un dueño/socio).
