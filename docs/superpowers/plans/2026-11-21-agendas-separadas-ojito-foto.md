# Agendas separadas, ojito y foto — plan

> Ejecución: nativa (el usuario pidió arrancar). Un solo deploy al final, con backup.

**Spec:** `docs/superpowers/specs/2026-11-21-agendas-separadas-ojito-foto-design.md`

## Restricciones

- Migración nueva `0017_agendas_por_jerarquia.sql` (y la foto en la misma); nunca editar las aplicadas.
- El anónimo sigue con sus 5 funciones; funciones nuevas con grant explícito.
- Un negocio real en producción: la migración no toca datos.

## Review Focus

- Socio intenta leer/mover/cancelar un turno del titular, o mover uno suyo a la agenda del titular → no puede.
- Socio crea "+ Turno" o turno fijo en la agenda del titular → SIN_PERMISO.
- Titular sigue viendo todo; empleado sin cambios.
- Profesional sin usuario: visible para todos los dueños.
- Negocio con un solo dueño: nada cambia.

## Tareas

1. **Migración + pruebas.** `public.es_titular(negocio uuid) → boolean`, `public.ve_agenda(negocio uuid, profesional uuid) → boolean` (definer, stable, grant a `agenda2_usuario`). Reemplazar políticas de turnos, turnos_fijos, bloqueos, horarios (escrituras), integraciones; reescribir `crear_turno_panel`, `crear_turno_fijo`, `terminar_turno_fijo`, `estadisticas_negocio` (clientes nuevos), `inasistencias_que_limitan` y `quitar_limite_cliente` (definer + chequeo). Tabla `profesional_fotos`. Prueba "socios: agendas por jerarquía" en `scripts/test-db.mjs`.
2. **Panel.** Filtrar listados de profesionales con `public.ve_agenda(negocio_id, id)` en agenda, turnos, ausencias, estadísticas, integraciones; etiqueta "Lo mío y los empleados" para socios.
3. **Ojito.** Componentes cliente `OjitoPlata` (botón) y `Plata` (texto tapado) con contexto y localStorage; usar en estadísticas.
4. **Foto.** `src/lib/foto-profesional.ts`, acciones subir/quitar en profesionales, ruta `/panel/profesionales/[id]/foto`, componente de carga (reusa el achicado del logo), avatar en Profesionales y Accesos.
5. **Verificar y publicar.** test:db, typecheck, lint, build; commit; push; main; backup; deploy; CLAUDE.md.
