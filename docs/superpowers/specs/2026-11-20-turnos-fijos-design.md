# Turnos fijos (semanales y cada 15 días)

## Para qué

Clientes que vienen siempre el mismo día y horario (todas las semanas o cada 2 semanas). El negocio los deja fijos una vez y no los carga a mano; ese horario no lo toma nadie desde la página de reservas.

## Objetivos / no objetivos

- Sí: crear desde el panel un turno fijo (cliente, profesional, servicio, día de la semana, hora, cada 1 o 2 semanas, desde, hasta opcional). Verlo y terminarlo desde la ficha del cliente.
- Sí: cada ocurrencia es un turno real (bloquea el horario, recordatorio, estadísticas, Google).
- No: el cliente no crea turnos fijos desde el portal. No hay otras frecuencias (mensual, etc.).
- Anti-objetivo: tocar `horarios_libres`, el EXCLUDE de `turnos` o los recordatorios para que entiendan repeticiones virtuales.

## Enfoques

1. **Regla + turnos reales por adelantado (elegido).** Tabla `turnos_fijos`; se generan turnos reales para las próximas 8 semanas y el cron horario completa. Todo lo existente sigue andando sin cambios.
2. Repeticiones virtuales calculadas al vuelo: obliga a cambiar disponibilidad, anti-superposición, recordatorios y estadísticas. Descartado.
3. Generar N turnos una sola vez al crearlo: simple, pero se corta y hay que acordarse de renovarlo. Descartado.

## Diseño

- Migración `0015_turnos_fijos.sql`:
  - `public.turnos_fijos` (negocio, profesional, servicio, cliente, `dia_semana`, `hora` local, `cada_semanas` 1|2, `desde` date, `hasta` date null, `generado_hasta` date, `terminado_at`, notas, created_at). RLS igual que turnos: dueño todo el negocio, empleado su agenda.
  - `turnos.turno_fijo_id` (nullable, FK on delete set null). `origen` sigue en `'panel'` (al implementar: la insignia sale de `turno_fijo_id`).
  - `public.generar_turnos_fijos(fijo_id, hasta)` security definer: crea las ocurrencias faltantes hasta la fecha; si una choca (turno, bloqueo, fuera de horario no se chequea, igual que el panel) se saltea esa fecha y se devuelve la lista de salteadas. No recrea fechas ya generadas (aunque se hayan cancelado): usa `generado_hasta`.
  - Crear el fijo desde el panel: función que inserta la regla (y la ficha del cliente como `crear_turno_panel`) y genera las 8 semanas.
  - Terminar: marca `terminado_at`/`hasta` y cancela los turnos futuros del fijo en estado pendiente/confirmado.
  - Cron: `generar_turnos_fijos` para todos los activos de negocios habilitados, ventana de 8 semanas.
- UI: casilla "Repetir" en "+ Turno" con selector "Todas las semanas / Cada 2 semanas". En la ficha del cliente y en el detalle del turno: "Turno fijo" con su regla y botón "Terminar". Insignia "Turno fijo" en la agenda.
- Permisos: el empleado solo en su agenda; escribir requiere negocio habilitado (trigger existente).

## Decisiones del builder

Nombres exactos, formato de los avisos de fechas salteadas, ventana exacta (8 semanas).
