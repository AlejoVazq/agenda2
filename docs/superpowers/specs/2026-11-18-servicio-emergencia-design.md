# Servicio de emergencia (se coordina por WhatsApp)

## Para qué

Lo pidió el peluquero amigo: a veces un cliente necesita un corte un día que no atiende (p. ej. un lunes). Para eso ofrece un "servicio de emergencia", más caro, que **no se reserva en el calendario**: se ve el precio y un link directo para hablar por WhatsApp con quien lo atiende. Tiene que ser una opción fácil de activar al crear o editar un servicio.

- Objetivo: que el cliente encuentre la opción aunque no haya horarios libres, vea el precio y abra el chat en un toque.
- No es objetivo: reservar en el calendario, pagar seña o limitar por día u horario.
- Sería un fracaso si un servicio de emergencia terminara reservándose online o metiera turnos en la agenda solo.

## Enfoques

- **A. Bloque aparte en la página de reservas (elegido por el usuario).** El servicio se marca como emergencia y aparece en una tarjeta fuera de los pasos, siempre visible, sin depender de profesionales ni horarios.
- B. Dentro del paso "Servicio": con "profesional primero" queda escondido detrás de elegir profesional y obliga a asignarlo a alguien. Descartado.
- C. Contacto de urgencia en la configuración del negocio: no es "una opción al agregar un servicio". Descartado.

## Diseño

**Base (migración 0013):**
- `servicios.emergencia boolean not null default false`.
- `servicios.contacto_whatsapp text` (opcional, normalizado como `normalizar_telefono`, `^[0-9]{8,15}$`). Si está vacío se usa el teléfono del negocio.
- `negocio_publico`: `servicios` deja afuera los de emergencia y se suma `emergencias`: activos, con `id`, `nombre`, `descripcion`, `precio` y `whatsapp` (el del servicio o el del negocio normalizado). Un servicio de emergencia sin ningún número no se publica. No exige profesionales asignados.
- `crear_reserva`, `horarios_libres` y `dias_disponibles` rechazan o ignoran los servicios de emergencia (defensa en la base, aunque el portal no los ofrezca).

**Panel (`/panel/servicios`):**
- En el formulario, la casilla "Servicio de emergencia (se coordina por WhatsApp)". Al marcarla aparece el campo "WhatsApp de contacto" (ayuda: "Si lo dejás vacío, usamos el teléfono del negocio: …"). Si el negocio no tiene teléfono, el campo es obligatorio.
- La duración sigue (decisión de Claude: sirve si el dueño carga el turno a mano desde la agenda; la ayuda lo aclara). "Disponible para reservar online" pasa a leerse "Mostrar en tu página".
- En la lista, la insignia "Emergencia". En la ficha del profesional no hace falta asignarlo.
- Desde la agenda del panel se puede cargar a mano como cualquier servicio.

**Portal (`/n/[slug]`):**
- Debajo del bloque de reserva, la tarjeta "¿Necesitás un turno urgente?" con cada servicio de emergencia: nombre, precio, descripción y el botón "Hablar por WhatsApp" → `https://wa.me/<número>?text=Hola, quiero pedir un turno de emergencia (<servicio>)` (con `encodeURIComponent`, en una pestaña nueva).
- Si las reservas están apagadas por la membresía (`reservas_habilitadas = false`), la tarjeta tampoco se muestra.

**Pruebas (`test:db`):** `negocio_publico` separa los de emergencia, usa el número del negocio si falta y no publica los que no tienen número; `crear_reserva` rechaza un servicio de emergencia.

**Docs:** un renglón en CLAUDE.md (Arquitectura).

## Queda para quien lo arme

Textos finales, estilo de la tarjeta (con `tema-negocio`) y nombres internos.
