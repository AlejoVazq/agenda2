# Turnos fijos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turnos fijos semanales o cada 2 semanas, que generan turnos reales 8 semanas por adelantado.

**Architecture:** Tabla `public.turnos_fijos` (la regla) + `turnos.turno_fijo_id`. Funciones `security definer` crean la regla, generan ocurrencias (salteando choques) y la terminan; el cron completa la ventana. El panel usa el formulario de "+ Turno" con un selector "Repetir".

**Tech Stack:** PostgreSQL 18 (plpgsql), Next.js 16 Server Actions, zod 4, PGlite para `test:db`.

**Spec:** `docs/superpowers/specs/2026-11-20-turnos-fijos-design.md`

## Global Constraints

- Todo en español es-AR (código, textos, commit).
- Nueva migración `db/migraciones/0015_turnos_fijos.sql`; nunca editar una aplicada.
- Ninguna función nueva ejecutable por `public`; grants explícitos. El anónimo sigue con sus 5 funciones.
- Ventana de generación: 8 semanas (56 días) desde hoy (fecha local del negocio).
- Frecuencia: `cada_semanas in (1, 2)`.
- Un empleado no lee fichas: la regla guarda nombre/teléfono/mail como `*_reserva`.

## Decisiones (del builder)

- La primera ocurrencia es `desde` (fecha local del turno cargado); las siguientes, `desde + 7·cada_semanas·k`. No hay columna `dia_semana`.
- No hay "hasta": se termina con un botón (cancela los turnos futuros activos de la regla, sin mandar mails al cliente).
- Para cambiar el día u hora: terminar y crear otro. Mover una ocurrencia suelta funciona como siempre.
- `origen` sigue en `'panel'`; la insignia "Turno fijo" sale de `turno_fijo_id`.
- Fechas salteadas (ocupado o ausencia) se guardan en `turnos_fijos.fechas_salteadas` y se muestran en el detalle del turno y la ficha.
- `turnos_fijos.cliente_id` con `on delete cascade` (borrar la ficha borra la regla; `borrar_cliente` ya exige que no haya turnos por venir).
- Profesional o servicio inactivos: no se generan ocurrencias.

## Review Focus

- Negocio apagado/vencido: el cron no debe fallar ni crear turnos (filtrar `plataforma.negocio_toma_reservas`).
- Correr la generación dos veces no duplica (usa `generado_hasta`).
- Una ocurrencia cancelada no se vuelve a crear.
- Choque con turno o ausencia: se saltea esa fecha, el resto se crea.
- Empleada: solo en su agenda; no lee reglas de otras agendas.

---

### Task 1: Migración 0015 + pruebas

**Files:** Create `db/migraciones/0015_turnos_fijos.sql`; Modify `scripts/test-db.mjs` (prueba nueva antes de `await db.close()`), `CLAUDE.md` (cantidad de pruebas).

**Interfaces (Produces):**
- `public.crear_turno_fijo(p_profesional_id uuid, p_servicio_id uuid, p_inicio timestamptz, p_cada_semanas int, p_cliente_nombre text, p_cliente_telefono text, p_cliente_email text default null, p_notas text default null) returns table (id uuid, turnos uuid[], salteadas date[])` → usuario.
- `public.terminar_turno_fijo(p_id uuid) returns uuid[]` (turnos cancelados) → usuario.
- `public.completar_turnos_fijos() returns integer` (turnos creados) → servidor.
- `public.generar_turnos_fijos(p_id uuid, p_hasta date)` interna, sin grants.

- [ ] Prueba "turnos fijos: semanal y cada 2 semanas, salteos, cron, terminar y permisos": eva crea en agenda ajena → `SIN_PERMISO`; eva crea semanal en su agenda → 9 turnos (desde lunes hasta lunes+56, si lunes ≤ hoy+2… usar conteo `between 8 and 9`), todos con `turno_fijo_id`; ana crea cada 2 semanas con una ausencia el 2º lunes y un turno ocupado el 3º → ese día figura en `salteadas`; `completar_turnos_fijos` dos veces no duplica; cancelar una ocurrencia y regenerar no la recrea; anon/ana no ejecutan `completar_turnos_fijos`; beto no ve las reglas; `terminar_turno_fijo` cancela los futuros y la regla queda con `terminado_at`.
- [ ] `npm run test:db` → falla (no existe la función).
- [ ] Escribir la migración.
- [ ] `npm run test:db` → pasa.
- [ ] Commit.

### Task 2: Panel

**Files:** Modify `src/lib/validaciones.ts` (`repetir`), `src/app/panel/agenda/acciones.ts` (`crearTurnoPanel` llama a `crear_turno_fijo` si `repetir > 0`; nueva `terminarTurnoFijo(id)`), `src/app/panel/agenda/formulario-turno.tsx` (Select "Repetir"), `src/app/panel/agenda/agenda.tsx` (mensaje de `onListo`, insignia), `src/lib/datos-panel.ts` (`turno_fijo_id`), `src/app/panel/turnos/[id]/page.tsx` (tarjeta "Turno fijo" con Terminar), `src/app/panel/clientes/[id]/page.tsx` (lista de turnos fijos activos), `src/app/api/cron/route.ts` (tarea `turnosFijos`), `src/lib/fechas.ts` si hace falta un helper de día de semana.

- [ ] Implementar; mensaje al crear: "Turno fijo creado: N turnos agendados." + ", no se pudo el 25/11 y 9/12 (ocupado)" si hay salteos.
- [ ] `npm run typecheck`, `npm run lint`, `npm run build` sin errores.
- [ ] Probar en local (crear fijo, ver agenda, terminar).
- [ ] Commit, push, deploy (backup antes) y actualizar CLAUDE.md/README.
