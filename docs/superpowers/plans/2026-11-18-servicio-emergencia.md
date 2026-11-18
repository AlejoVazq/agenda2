# Servicio de emergencia — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un servicio marcado como "emergencia" no se reserva en el calendario: el portal lo muestra aparte con precio y un botón de WhatsApp.

**Architecture:** Dos columnas nuevas en `servicios` (migración 0013). `negocio_publico` los separa en una lista `emergencias` (con el número ya resuelto) y `horarios_libres` deja de dar horarios para ellos (así `crear_reserva` y `dias_disponibles` los rechazan solos). Panel: casilla + campo en el formulario de servicio. Portal: tarjeta debajo del bloque de reserva.

**Tech Stack:** Next.js 16 (App Router, Server Actions), PostgreSQL 18 con `pg`, zod 4, Tailwind 4, pruebas con PGlite (`scripts/test-db.mjs`).

**Spec:** `docs/superpowers/specs/2026-11-18-servicio-emergencia-design.md`

## Global Constraints

- Todo en español es-AR: código, nombres, textos, commits.
- Nunca se edita una migración aplicada: todo va en `db/migraciones/0013_servicio_emergencia.sql`.
- `agenda2_usuario` tiene grants de update **por columna** en `servicios` (0001, línea 677): sumar `grant update (emergencia, contacto_whatsapp)`.
- El anónimo sigue ejecutando solo las 5 funciones públicas (`create or replace` conserva los grants; no agregar funciones nuevas).
- Teléfonos guardados normalizados (`normalizar_telefono` en SQL / `normalizarTelefono` en TS, 10 dígitos para AR); el link se arma con `linkWhatsApp(telefono, texto)` de `src/lib/whatsapp.ts`.
- Mensaje del link, exacto: `Hola, quiero pedir un turno de emergencia (<nombre del servicio>)`.
- Antes de terminar: `npm run test:db`, `npm run typecheck`, `npm run lint`, `npm run build`.

## Review Focus

1. Negocio sin teléfono y servicio de emergencia sin número → no se publica (ni rompe el portal). Test en Task 1.
2. Servicio de emergencia que además tiene profesionales asignados (p. ej. creado con un solo profesional, que la acción asigna sola) → igual no aparece en `servicios` ni tiene horarios. Test en Task 1.
3. Desmarcar "emergencia" en un servicio existente → vuelve al flujo normal (si tiene profesionales). Test en Task 1.
4. Número escrito con formato libre (`+54 9 341 555-1234`, `0341 15 555 1234`) → se guarda normalizado a 10 dígitos. Test de zod en Task 2 (vía `normalizarTelefono`).
5. Reservas apagadas por la membresía → la tarjeta no se muestra. Cubierto en Task 3 (condición en `page.tsx`), verificación manual.

---

### Task 1: Base de datos (migración 0013, seed y pruebas)

**Files:**
- Create: `db/migraciones/0013_servicio_emergencia.sql`
- Modify: `db/seed.sql` (Peluquería Caballeros, ~línea 75)
- Test: `scripts/test-db.mjs` (nueva prueba después de "público: negocio_publico…", ~línea 330; ajustar la prueba del seed, ~línea 1690)

**Interfaces:**
- Produces: columnas `servicios.emergencia boolean not null default false`, `servicios.contacto_whatsapp text null check (contacto_whatsapp ~ '^[0-9]{8,15}$')`. `negocio_publico(slug)` devuelve además `emergencias: [{ id, nombre, descripcion, precio, whatsapp }]` (whatsapp = `coalesce(s.contacto_whatsapp, public.normalizar_telefono(n.telefono))`, se omiten los que quedan sin número; orden `s.orden, s.nombre`; solo `s.activo`; sin exigir profesionales). `servicios` excluye `s.emergencia`.

- [ ] **Step 1: Escribir la prueba que falla** — `prueba("servicio de emergencia: aparte en el portal y sin horarios", …)` en `scripts/test-db.mjs`, usando `negA`, `profAna`, `lunes` ya definidos:
  - Como `ana`: insertar servicio `Urgencia` (60 min, precio 20000, `emergencia = true`, sin `contacto_whatsapp`) y asignarlo a `profAna` en `profesional_servicio`.
  - `negocio_publico('salon-ana')` como `anon`: `data.servicios.length === 1` (sigue solo el normal), `data.emergencias.length === 1`, `emergencias[0].nombre === 'Urgencia'`, `precio === 20000`, `whatsapp === normalizar_telefono(<teléfono de negA>)` (leerlo con `select public.normalizar_telefono(telefono) from public.negocios where id = negA`); `!('duracion_min' in emergencias[0])`.
  - `horarios_libres(negA, urgencia, lunes, profAna)` → 0 filas.
  - `crear_reserva(negA, urgencia, profAna, <lunes 10:00>, …)` con `reservar` → `falla(…, /HORARIO_NO_DISPONIBLE/)`.
  - Como `ana`: `update … set contacto_whatsapp = '3415551234'` → `emergencias[0].whatsapp === '3415551234'`.
  - Negocio sin teléfono: poner `negocios.telefono = null` y `contacto_whatsapp = null` → `emergencias.length === 0`; restaurar el teléfono.
  - Como `ana`: `update … set emergencia = false` → `servicios.length === 2`, `emergencias.length === 0`, `horarios_libres` del lunes > 0.
  - Como `ana`: `update … set contacto_whatsapp = '12'` → falla por el check.
  - Al final borrar el servicio.
- [ ] **Step 2: Correr y ver que falla** — `npm run test:db` → FAIL (columna `emergencia` no existe).
- [ ] **Step 3: Migración 0013** — columnas y check de arriba; `grant update (emergencia, contacto_whatsapp) on public.servicios to agenda2_usuario;`; `create or replace function public.negocio_publico` copiando la definición vigente de `db/migraciones/0002_suscripciones.sql` (desde ~línea 225) con `and not s.emergencia` en el `where` de `servicios` y la nueva clave `emergencias`; `create or replace function public.horarios_libres` copiando la de `0001_inicial.sql:1062` con `and not s.emergencia` en el CTE `srv`. Comentario arriba explicando el porqué (una línea por cambio).
- [ ] **Step 4: Seed** — en Peluquería Caballeros sumar `Corte de emergencia` (30 min, 18000, orden 5, `emergencia = true`, descripción `Fuera del horario habitual (por ejemplo, un lunes).`), sin asignar a profesionales. En la prueba del seed: `pelu.servicios.length` sigue 4 y agregar `assert.equal(pelu.emergencias.length, 1)`.
- [ ] **Step 5: Correr y ver que pasa** — `npm run test:db` → `NN pruebas OK` (una más que antes).
- [ ] **Step 6: Commit** — `git add db/migraciones/0013_servicio_emergencia.sql db/seed.sql scripts/test-db.mjs` → `git commit -m "Base: servicio de emergencia (aparte en negocio_publico, sin horarios)"`.

### Task 2: Panel — formulario y lista de servicios

**Files:**
- Modify: `src/lib/tipos.ts` (`Servicio`, ~línea 60)
- Modify: `src/lib/validaciones.ts` (`esquemaServicio`, ~línea 155)
- Modify: `src/app/panel/servicios/acciones.ts` (`guardarServicio`)
- Modify: `src/app/panel/servicios/formulario.tsx`
- Modify: `src/app/panel/servicios/page.tsx` (insignia)
- Modify: las páginas `nuevo/page.tsx` y `[id]/page.tsx` si hace falta pasar el teléfono del negocio al formulario.

**Interfaces:**
- Consumes: columnas de Task 1.
- Produces: `Servicio` con `emergencia: boolean` y `contacto_whatsapp: string | null`. `FormularioServicio({ servicio, telefonoNegocio }: { servicio?: Servicio; telefonoNegocio: string | null })`.

- [ ] **Step 1: Esquema** — en `esquemaServicio` sumar `emergencia: checkbox` y `contacto_whatsapp`: string opcional → `normalizarTelefono` (importar de `@/lib/whatsapp`) → `null` si queda vacío; si no es `^[0-9]{8,15}$`, error `"Número inválido"`. La regla "obligatorio si el negocio no tiene teléfono" va en la acción (el esquema no conoce el negocio): si `d.emergencia && !d.contacto_whatsapp && !sesion.negocio.telefono` → `{ errores: { contacto_whatsapp: ["Poné un WhatsApp: tu negocio no tiene teléfono cargado."] } }`.
- [ ] **Step 2: Acción** — `guardarServicio` guarda `emergencia` y `contacto_whatsapp` en el insert y el update. La asignación automática al único profesional se hace solo si `!d.emergencia`.
- [ ] **Step 3: Formulario** — `Casilla name="emergencia"` con etiqueta `Servicio de emergencia (se coordina por WhatsApp)` y descripción `No se reserva en el calendario: tu página muestra el precio y un botón para escribirte.`. Estado local (`useState` desde `marcado("emergencia", servicio?.emergencia ?? false)`): al marcarla se muestra `Campo etiqueta="WhatsApp de contacto"` (`name="contacto_whatsapp"`, `inputMode="tel"`), con ayuda `Si lo dejás vacío, usamos el teléfono del negocio: <telefonoNegocio>.` o, si no hay, `Obligatorio: tu negocio no tiene teléfono cargado.`. Ayuda de la duración cuando está marcada: `Se usa si cargás el turno a mano desde la agenda.`. La casilla `activo` pasa a decir `Mostrar en tu página`.
- [ ] **Step 4: Lista** — en `src/app/panel/servicios/page.tsx`, `<Insignia>Emergencia</Insignia>` (color `ambar`) en los que tienen `emergencia`; no marcarlos "incompletos" por no tener profesionales si existe esa marca.
- [ ] **Step 5: Verificar** — `npm run typecheck` y `npm run lint` sin errores. Manual con `npm run db:local` + `npm run dev`, entrando como `barbero@turnos.test`: crear uno de emergencia sin número, editarlo poniendo `0341 15 555 1234` y ver que queda `3415551234`.
- [ ] **Step 6: Commit** — `git commit -m "Panel: opción de servicio de emergencia en el formulario de servicios"`.

### Task 3: Portal — tarjeta "¿Necesitás un turno urgente?" y docs

**Files:**
- Modify: `src/lib/publico.ts` (tipo `NegocioPublico`)
- Create: `src/app/n/[slug]/emergencias.tsx` (componente de servidor)
- Modify: `src/app/n/[slug]/page.tsx` (~línea 160, después del bloque de reserva y antes de las opiniones)
- Modify: `CLAUDE.md` (Arquitectura, un renglón)

**Interfaces:**
- Consumes: `negocio_publico.emergencias` de Task 1.
- Produces: `export type ServicioEmergencia = { id: string; nombre: string; descripcion: string | null; precio: number | null; whatsapp: string }`; `NegocioPublico.emergencias: ServicioEmergencia[]`; `Emergencias({ servicios }: { servicios: ServicioEmergencia[] })`.

- [ ] **Step 1: Tipo** — sumar `ServicioEmergencia` y `emergencias` a `NegocioPublico`.
- [ ] **Step 2: Componente** — tarjeta blanca con el mismo estilo que la de reserva (`rounded-[2rem] bg-white … shadow-flotante`), título `¿Necesitás un turno urgente?`; por servicio: nombre, precio con el formateador de precios que ya usa `reserva.tsx`, descripción si hay, y un link `target="_blank"` con `IconoWhatsApp` y el texto `Hablar por WhatsApp` a `linkWhatsApp(s.whatsapp, \`Hola, quiero pedir un turno de emergencia (${s.nombre})\`)`, con el mismo estilo de botón verde que "Escribir por WhatsApp" en `page.tsx`. Devuelve `null` si la lista está vacía.
- [ ] **Step 3: Página** — renderizar `<Emergencias servicios={negocio.emergencias} />` solo si `negocio.reservas_habilitadas`.
- [ ] **Step 4: CLAUDE.md** — en Arquitectura: `**Servicio de emergencia** (migración 0013): servicios.emergencia + contacto_whatsapp (vacío = teléfono del negocio). No se reservan (horarios_libres no da horarios): el portal los muestra aparte con precio y link de WhatsApp (negocio_publico.emergencias).`
- [ ] **Step 5: Verificación completa** — `npm run test:db`, `npm run typecheck`, `npm run lint`, `npm run build`, todo OK. Manual: `/n/peluqueria-caballeros` en ancho de celular muestra la tarjeta con "Corte de emergencia", $ 18.000 y el link abre `wa.me/5493415559876?text=Hola%2C%20quiero%20pedir…`; el corte de emergencia no aparece en el paso "Servicio".
- [ ] **Step 6: Commit** — `git commit -m "Portal: tarjeta de servicios de emergencia con link a WhatsApp"`.
