# Reseñas por local y elegir profesional primero

Fecha: 2026-11-17. Pedido del usuario: "un sistema de reseñas y opiniones para cada local" y "primero se debería seleccionar al profesional antes de mostrar los servicios". Libertad creativa; inspiración: una página de AgendaPro con ★ 4.9 "(Ver 42 reseñas)" bajo el nombre y chips de profesionales arriba de los servicios. Las decisiones de abajo son de Claude (el usuario estaba ausente) y se pueden corregir.

## Por qué

- Las reseñas dan confianza a quien entra por primera vez desde Instagram, y le muestran al dueño cómo lo ven.
- En peluquería y barbería el cliente va "con" alguien: elige primero al peluquero y después qué se hace. Con socios (migración 0010) esto pesa todavía más: cada uno tiene su clientela.

## Objetivos

1. Solo opina quien **tuvo un turno real** en el local: nada de reseñas falsas ni de terceros.
2. Puntaje de 1 a 5 estrellas + comentario opcional. Se muestra el promedio y la cantidad en la cabecera del local y por profesional.
3. El dueño responde en público y puede ocultar un **comentario** ofensivo, pero las estrellas siempre cuentan (no puede maquillar el promedio).
4. Pedir la reseña por mail unas horas después del turno, con el link de su turno.
5. En la reserva: Profesional → Servicio → Día y horario → Tus datos.

## No objetivos / anti-objetivos

- Sin fotos en reseñas, sin "me gusta", sin reseñas sin turno, sin moderación desde `/admin` (se puede sumar).
- No borrar ni editar estrellas ajenas desde el panel.
- No se agregan funciones al rol anónimo: `test:db` exige que ejecute solo las 5 públicas.

## Enfoques considerados

- **A (elegido): reseña atada a un turno, desde `/t/[token]`.** El link del turno ya es secreto y ya llega por mail; prueba que la persona fue. Escritura con una función `security definer` que solo ejecuta el servidor (como `crear_reserva`), con límite por IP.
- B: reseña con verificación por mail aparte. Más fricción y más código, sin ganancia frente a A.
- C: integrar reseñas de Google. Depende de Google Business y de una API paga; fuera de alcance.

## Diseño

### Base (migración 0012_resenas.sql)

- `negocios.resenas_activas boolean not null default true` (+ `grant update (resenas_activas)` al usuario). Apagado: no se muestran, no se piden ni se aceptan nuevas.
- `turnos.resena_pedida_at timestamptz` (marca del mail de pedido).
- Tabla `public.resenas`: `id`, `negocio_id`, `turno_id` (unique, FK on delete cascade), `profesional_id`, `servicio_id`, `autor` (texto ya armado: "Juan P."), `estrellas smallint 1..5`, `comentario text ≤ 600` (null si vacío), `comentario_oculto boolean default false`, `respuesta text ≤ 600`, `respondida_at`, `created_at`, `updated_at`.
  - RLS: select para `es_dueno(negocio_id)`; update solo columnas `respuesta`, `respondida_at`, `comentario_oculto` y solo el dueño. Trigger `plataforma.tg_exigir_habilitado('negocio_id')` (desde el panel exige estar habilitado; las altas del cliente van con el servidor y no lo disparan).
  - Servidor: select/insert/update/delete.
- `public.dejar_resena(p_token text, p_estrellas int, p_comentario text) returns jsonb` (solo `agenda2_servidor`): el turno tiene que existir, estar `confirmado` o `completado`, haber **terminado** (`fin <= now()`), hace **≤ 60 días**, y el negocio con `resenas_activas`. Si ya hay reseña de ese turno, la actualiza (estrellas y comentario) mientras tenga ≤ 60 días; al editar, la respuesta del dueño se conserva. `autor` = primer nombre + inicial del apellido de `nombre_reserva` (o del cliente). Errores con `raise exception 'RESENA_…'`.
- `public.reclamar_pedidos_resena(p_limite int)` (solo servidor, como `reclamar_recordatorios`): turnos `confirmado/completado` que terminaron hace entre 2 y 48 h, sin `resena_pedida_at`, sin reseña, con mail, negocio con `resenas_activas` y que toma reservas. Marca y devuelve los datos para el mail.

### App

- `src/lib/resenas.ts` (server-only, `comoServidor`, `cache`):
  - `resumenResenas(negocioId)` → `{ promedio, cantidad, porEstrellas[5], porProfesional: Record<id, {promedio, cantidad}> }` (vacío si `resenas_activas` es false).
  - `resenasPublicas(negocioId, { limite, desde })` → lista paginada (sin comentario si está oculto; con respuesta).
  - `resenaDeTurno(token)` → `{ puede: boolean, motivo?, resena? }`.
  - `autorVisible(nombre)` en TS solo para mostrar; el que vale es el de SQL.
- Portal `/n/[slug]`:
  - Cabecera: ★ promedio (1 decimal) + "(N reseñas)" con link a `#opiniones`, si hay al menos 1.
  - Debajo de la tarjeta de reserva: sección "Opiniones" con resumen (promedio grande, barras por estrellas) y las 5 últimas con comentario visible; botón "Ver todas" a `/n/[slug]/opiniones` (página con 20 por página, `?pagina=`).
  - Paso "¿Con quién?": cada profesional muestra ★ promedio (cantidad) si tiene.
- Reserva (`reserva.tsx`): pasos `profesional → servicio → horario → datos`.
  - Con un solo profesional se saltea su paso (y la barra muestra 3 pasos).
  - "Cualquiera" (primera opción, "Más horarios") muestra todos los servicios; un profesional muestra solo los suyos.
  - Si eligió "Cualquiera" y el servicio lo hace una sola persona, se fija esa persona.
  - `?paso=` y el botón atrás siguen funcionando; "Cambiar" en el resumen vuelve al primer paso.
- `/t/[token]`: si `puede`, tarjeta "¿Cómo te fue?" con estrellas grandes y comentario (zod: estrellas 1..5, comentario ≤ 600). Si ya opinó: muestra su reseña, la respuesta del negocio y "Editar". Límite por IP `resena` 10/hora.
- Mail `emailPedidoResena` (plantillas.ts) y paso nuevo en `/api/cron` (como recordatorios: si falla, se desmarca).
- Panel `/panel/opiniones` (solo dueño, ítem "Opiniones" en el menú): resumen, interruptor "Mostrar y pedir opiniones", filtro por profesional y lista con "Responder" / "Editar respuesta" / "Ocultar comentario" / "Mostrar comentario".

## Lo que queda a criterio del que construye

Textos finales, estilos, iconos de estrellas (SVG propio), orden visual de la sección.
