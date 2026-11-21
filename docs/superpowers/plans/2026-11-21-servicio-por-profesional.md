# Precio y duración por profesional — plan

> Ejecución: nativa (el usuario pidió avanzar directo y publicar al terminar).

**Objetivo:** cada profesional puede tener su precio y su duración en un servicio compartido.
**Spec:** `docs/superpowers/specs/2026-11-21-servicio-por-profesional-design.md`

## Restricciones

- Nunca editar una migración aplicada: todo va en `db/migraciones/0016_servicio_por_profesional.sql`.
- Ninguna función nueva ejecutable por `public` ni por el anónimo (sigue con 5).
- Hay un negocio real en producción: la migración no puede borrar ni cambiar datos existentes (solo agrega columnas nulas).

## Review Focus

- "Cualquiera" con dos profesionales de duración distinta: cada horario libre usa la duración de quien queda libre, y el turno se crea con el fin y el precio de ese profesional.
- Turno del panel con un profesional que no tiene asignado el servicio: usa precio y duración generales.
- Guardar el servicio sin ningún profesional tildado: queda sin asignar (no se puede reservar online), sin error.
- Precio por profesional vacío vs. 0: vacío = general; 0 = gratis.
- Turnos fijos: generan con el precio del profesional.

## Tareas

### 1. Migración 0016 + pruebas (`scripts/test-db.mjs`)
- Columnas `precio numeric(12,2) check (precio >= 0)`, `duracion_min integer check (between 5 and 600)` en `profesional_servicio`.
- `public.guardar_profesionales_servicio(p_servicio_id uuid, p_filas jsonb) returns void` (invoker; dueño; filas `[{profesional_id, precio|null, duracion_min|null}]`; reemplaza las del servicio). Grant solo a `agenda2_usuario`.
- Reescribir `horarios_libres`, `crear_reserva`, `crear_turno_panel`, `crear_turno_fijo`, `generar_turnos_fijos`, `negocio_publico` con `coalesce(ps.x, s.x)`; `negocio_publico` suma `por_profesional`.
- Prueba "servicio por profesional": precio/duración distintos → horarios_libres, crear_reserva con y sin profesional, crear_turno_panel, turno fijo, negocio_publico, permisos (empleada y otro negocio no pueden guardar).

### 2. Panel de servicios
- `src/app/panel/servicios/[id]/page.tsx` y `nuevo/page.tsx` leen profesionales activos y filas de `profesional_servicio`.
- `formulario.tsx`: sección "¿Quién lo hace?" (casilla + precio + duración por profesional, precargados con los generales). Campos `prof_<id>`, `precio_<id>`, `duracion_<id>`.
- `acciones.ts`: valida con zod y llama a `guardar_profesionales_servicio` en la misma transacción (valores iguales a los generales se guardan como null).

### 3. Profesionales
- Quitar `FormularioServiciosProfesional` y `guardarServiciosProfesional`; mostrar resumen de solo lectura con links a cada servicio.
- Al crear un profesional, asignarle los servicios activos que no son de emergencia.

### 4. Portal y agenda
- `src/lib/publico.ts`: `por_profesional: Record<string, {precio, duracion_min}> | null`.
- `reserva.tsx`: helper `valoresDe(servicio, profesionalId|null)` → precio/duración exactos o "desde".
- Agenda "+ Turno": duración del profesional elegido.

### 5. Verificar y publicar
- `test:db`, `typecheck`, `lint`, `build`; commit; push; merge a `main`; backup + deploy en el VPS; probar `https://agenda2.tech`.
- Actualizar CLAUDE.md (arquitectura y estado).
