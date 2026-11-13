import "server-only";
import { after } from "next/server";
import { comoServidor, sql } from "@/lib/db";
import { enviarEmail } from "./enviar";
import { emailCambioPorNegocio, emailConfirmacion, emailNuevaReserva } from "./plantillas";

// Avisos por mail. Leen con el rol del servidor porque quien dispara el aviso es
// un cliente anónimo o un empleado que no lee fichas: el turno ya pasó por los
// permisos de la acción (o es la propia reserva) y el mail va al cliente o al
// negocio, nunca a quien hizo la acción. Las consultas son fijas por id.

type NegocioEmail = {
  nombre: string;
  direccion: string | null;
  telefono: string | null;
  zona_horaria: string;
  cancelacion_min_horas: number;
};

type TurnoEmail = {
  id: string;
  negocio_id: string;
  profesional_id: string;
  token_cancelacion: string;
  inicio: string;
  fin: string;
  precio: number | null;
  estado: string;
  sena_monto: number | null;
  pago_estado: string | null;
  /** Nombre, mail y celular de quien pidió el turno (o de la ficha si faltan). */
  cliente: string;
  email: string | null;
  telefono: string;
  servicio: string;
  profesional: string;
  negocio: NegocioEmail;
};

function leerTurno(turnoId: string) {
  return comoServidor((tx) =>
    tx.uno<TurnoEmail>(sql`
      select t.id, t.negocio_id, t.profesional_id, t.token_cancelacion, t.inicio, t.fin, t.precio,
             t.estado, t.sena_monto, t.pago_estado,
             coalesce(t.nombre_reserva, c.nombre) as cliente,
             coalesce(t.email_reserva, c.email) as email,
             coalesce(t.telefono_reserva, c.telefono) as telefono,
             s.nombre as servicio, p.nombre as profesional,
             json_build_object(
               'nombre', n.nombre, 'direccion', n.direccion, 'telefono', n.telefono,
               'zona_horaria', n.zona_horaria, 'cancelacion_min_horas', n.cancelacion_min_horas
             ) as negocio
      from public.turnos t
      left join public.clientes c on c.id = t.cliente_id
      join public.servicios s on s.id = t.servicio_id
      join public.profesionales p on p.id = t.profesional_id
      join public.negocios n on n.id = t.negocio_id
      where t.id = ${turnoId}`),
  );
}

/** Dueño y, si tiene usuario, el profesional de esa agenda. */
function equipoAvisado(t: TurnoEmail) {
  return comoServidor((tx) =>
    tx.varios<{ email: string }>(sql`
      select u."email" as email
      from public.perfiles p
      join auth."user" u on u."id" = p.id
      where p.negocio_id = ${t.negocio_id}
        and (p.rol = 'dueno' or p.profesional_id = ${t.profesional_id})`),
  );
}

function avisarAlEquipo(turnoId: string, tipo: "nueva" | "cancelada") {
  after(async () => {
    const t = await leerTurno(turnoId);
    if (!t) return;
    for (const { email } of await equipoAvisado(t)) {
      await enviarEmail(
        emailNuevaReserva(email, {
          turnoId: t.id,
          inicio: t.inicio,
          cliente: t.cliente,
          telefono: t.telefono,
          servicio: t.servicio,
          profesional: t.profesional,
          pendiente: t.estado === "pendiente",
          negocio: t.negocio.nombre,
          zona_horaria: t.negocio.zona_horaria,
          sena: t.pago_estado === "aprobado" ? t.sena_monto : null,
          cancelada: tipo === "cancelada",
        }),
      );
    }
  });
}

/**
 * Avisa al dueño (y al empleado de esa agenda, si tiene usuario) que entró una
 * reserva online. Corre después de responder al cliente.
 */
export function notificarNuevaReserva(turnoId: string) {
  avisarAlEquipo(turnoId, "nueva");
}

/** Avisa al dueño (y al profesional) que el cliente canceló desde su link: el horario quedó libre. */
export function notificarCancelacionCliente(turnoId: string) {
  avisarAlEquipo(turnoId, "cancelada");
}

/** Mail de confirmación al cliente que reservó online. */
export function notificarConfirmacionCliente(turnoId: string) {
  after(async () => {
    const t = await leerTurno(turnoId);
    if (!t?.email || t.estado === "cancelado") return;

    await enviarEmail(
      emailConfirmacion(t.email, {
        token: t.token_cancelacion,
        inicio: t.inicio,
        fin: t.fin,
        cliente: t.cliente,
        servicio: t.servicio,
        profesional: t.profesional,
        precio: t.precio,
        estado: t.estado,
        sena: t.pago_estado === "aprobado" ? t.sena_monto : null,
        negocio: t.negocio,
        cancelacion_min_horas: t.negocio.cancelacion_min_horas,
      }),
    );
  });
}

/**
 * Avisa al cliente (si dejó email) que el negocio canceló, movió o confirmó su
 * turno. Llamar solo después de que la acción (con RLS) modificó el turno.
 * Envía después de responder, para no demorar la acción.
 */
export function notificarCambioTurno(turnoId: string, tipo: "cancelado" | "reprogramado" | "confirmado") {
  after(async () => {
    const t = await leerTurno(turnoId);
    if (!t?.email) return;
    // No avisar cambios de turnos que ya pasaron.
    if (new Date(t.fin) < new Date()) return;

    await enviarEmail(
      emailCambioPorNegocio(
        t.email,
        {
          token: t.token_cancelacion,
          inicio: t.inicio,
          fin: t.fin,
          cliente: t.cliente,
          servicio: t.servicio,
          profesional: t.profesional,
          precio: t.precio,
          estado: t.estado,
          negocio: t.negocio,
          cancelacion_min_horas: t.negocio.cancelacion_min_horas,
        },
        tipo,
      ),
    );
  });
}
