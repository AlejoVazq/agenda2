# Reseñas y profesional primero — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reseñas verificadas por turno (1–5 ★ + comentario, respuesta del dueño) visibles en el portal, y el flujo de reserva Profesional → Servicio → Horario → Datos.

**Architecture:** Migración 0012 con tabla `resenas` (RLS, solo dueño en el panel) y dos funciones que solo ejecuta el servidor (`dejar_resena`, `reclamar_pedidos_resena`). La lectura pública va por `comoServidor` en `src/lib/resenas.ts` (el anónimo sigue con sus 5 funciones). UI en `/n/[slug]`, `/n/[slug]/opiniones`, `/t/[token]` y `/panel/opiniones`.

**Tech Stack:** Next.js 16.4.6 (App Router, Server Actions), pg sin ORM, zod 4, Tailwind 4, PGlite para `test:db`.

**Spec:** `docs/superpowers/specs/2026-11-17-resenas-y-profesional-primero-design.md`

## Global Constraints

- Todo en español es-AR (código, textos, commit).
- Nunca editar migraciones aplicadas; cada permiso explícito; ninguna función nueva para `agenda2_anonimo`.
- Comentario y respuesta: máx. 600 caracteres. Estrellas: 1..5. Ventana para opinar: hasta 60 días después de terminado el turno.
- Pedido por mail: turnos que terminaron hace entre 2 y 48 h.
- Antes de terminar: `test:db`, `typecheck`, `lint`, `build`.

## Review Focus

- Turno cancelado, ausente, pendiente o que todavía no terminó → no se puede opinar (test SQL).
- Segunda reseña del mismo turno → actualiza la existente, no duplica (test SQL).
- Comentario oculto por el dueño → el promedio lo sigue contando y el portal no muestra el texto (test SQL + lectura en `resenas.ts`).
- Negocio con `resenas_activas = false` → no acepta reseñas ni las pide (test SQL).
- Negocio con un solo profesional → la reserva no muestra el paso "¿Con quién?" y no queda trabada (prueba manual en el navegador).

---

### Task 1: Migración 0012 y pruebas de base

**Files:**
- Create: `db/migraciones/0012_resenas.sql`
- Modify: `scripts/test-db.mjs` (bloque nuevo antes de `await db.close()`, y `resenas` en la lista de la prueba de aislamiento si hace falta)

**Interfaces:**
- Produces: tabla `public.resenas` (columnas del spec); `negocios.resenas_activas`; `turnos.resena_pedida_at`; `public.dejar_resena(text, integer, text) returns jsonb` (`{id, nueva: boolean}`), errores `RESENA_NO_DISPONIBLE`, `RESENA_DESACTIVADA`; `public.reclamar_pedidos_resena(integer)` → `(turno_id, token, cliente, email, servicio, profesional, negocio, slug)`.

- [ ] Pruebas en `test-db.mjs` (como servidor): reseña de turno terminado OK; repetir actualiza (count = 1); turno cancelado / futuro → `RESENA_NO_DISPONIBLE`; `resenas_activas=false` → `RESENA_DESACTIVADA`; dueño ve y responde; empleado no ve; dueño no puede cambiar `estrellas` (permiso denegado); anónimo no ejecuta `dejar_resena`; `reclamar_pedidos_resena` devuelve el turno una sola vez.
- [ ] Correr `npm run test:db` → fallan las nuevas.
- [ ] Escribir la migración.
- [ ] `npm run test:db` → todas pasan.

### Task 2: Lecturas y validación

**Files:** Create `src/lib/resenas.ts`; Modify `src/lib/validaciones.ts`.

**Interfaces:**
- `resumenResenas(negocioId: string): Promise<ResumenResenas>`; `ResumenResenas = { promedio: number | null; cantidad: number; porEstrellas: [n1..n5]; porProfesional: Record<string, { promedio: number; cantidad: number }> }`.
- `resenasPublicas(negocioId: string, o: { limite: number; desplazamiento?: number; soloConComentario?: boolean }): Promise<ResenaPublica[]>`; `ResenaPublica = { id, autor, estrellas, comentario: string | null, respuesta: string | null, profesional: string, servicio: string, created_at }`.
- `resenaDeTurno(token: string): Promise<{ puede: boolean; resena: { estrellas; comentario; respuesta } | null }>`.
- `esquemaResena = z.object({ token: hex64, estrellas: z.coerce.number().int().min(1).max(5), comentario: texto opcional ≤ 600 })`.

- [ ] Implementar; `npm run typecheck` pasa.

### Task 3: Reserva con profesional primero

**Files:** Modify `src/app/n/[slug]/reserva.tsx`, `src/app/n/[slug]/page.tsx` (pasa `resumen.porProfesional`).

- [ ] Pasos `profesional → servicio → horario → datos`; saltear profesional si hay ≤ 1; filtrar servicios por `profesional_ids`; "Cualquiera" + servicio de una sola persona fija a esa persona; ★ por profesional.
- [ ] Probar en `next dev` con `estudio-luna` (varios profesionales) y `peluqueria-caballeros`.

### Task 4: Opiniones en el portal

**Files:** Modify `src/app/n/[slug]/page.tsx`; Create `src/app/n/[slug]/opiniones/page.tsx`, `src/components/estrellas.tsx`.

- [ ] Cabecera con ★ y link a `#opiniones`; sección "Opiniones" (resumen + 5 últimas con comentario + "Ver todas"); página paginada de 20.

### Task 5: Opinar desde el turno

**Files:** Create `src/app/t/[token]/opinar.tsx`; Modify `src/app/t/[token]/acciones.ts`, `src/app/t/[token]/page.tsx`.

- [ ] Acción `opinar(prev, formData)`: zod, `dentroDelLimite("resena", 10, 3600)`, `comoServidor` → `dejar_resena`, `revalidatePath("/n/<slug>")`. Tarjeta con estrellas, comentario, respuesta del negocio y "Editar".

### Task 6: Pedido por mail

**Files:** Modify `src/lib/email/plantillas.ts` (`emailPedidoResena`), `src/app/api/cron/route.ts` (paso `pedidosResena`, desmarca los fallidos).

### Task 7: Panel `/panel/opiniones`

**Files:** Create `src/app/panel/opiniones/page.tsx`, `acciones.ts`, `formularios.tsx`; Modify `src/app/panel/navegacion.tsx`.

- [ ] Acciones (`sesionParaAccion({ soloDueno: true })`): `responderResena`, `ocultarComentario`, `activarResenas`; todas vía `comoUsuario`.

### Task 8: Cierre

- [ ] Actualizar `CLAUDE.md` (bullet "Reseñas", test:db count) y este plan.
- [ ] `test:db`, `typecheck`, `lint`, `build`; probar en el navegador el flujo completo.
- [ ] Commit.
