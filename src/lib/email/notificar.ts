import "server-only";
import { after } from "next/server";
import { comoServidor, sql } from "@/lib/db";
import { enviarEmail } from "./enviar";
import {
  emailCambioPorNegocio,
  emailConfirmacion,
  emailNuevaReserva,
  emailPagoPedido,
  emailPedidoCliente,
  emailPedidoNegocio,
  type DatosPedidoEmail,
} from "./plantillas";

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

/**
 * El usuario de esa agenda (si tiene) y los dueños. Con socios, cada uno recibe los avisos
 * de su agenda y de las que no son de otro socio (las de los empleados o sin usuario).
 */
function equipoAvisado(t: TurnoEmail) {
  return comoServidor((tx) =>
    tx.varios<{ email: string }>(sql`
      select u."email" as email
      from public.perfiles p
      join auth."user" u on u."id" = p.id
      where p.negocio_id = ${t.negocio_id}
        and (
          p.profesional_id = ${t.profesional_id}
          or (p.rol = 'dueno' and not exists (
            select 1 from public.perfiles otro
            where otro.profesional_id = ${t.profesional_id} and otro.rol = 'dueno' and otro.id <> p.id
          ))
        )`),
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

// --- Pedidos de la tienda ---------------------------------------------------------------

function leerPedido(pedidoId: string) {
  return comoServidor((tx) =>
    tx.uno<DatosPedidoEmail & { negocio_id: string; estado: string }>(sql`
      select p.id as "pedidoId", p.negocio_id, p.token, p.numero, p.nombre as cliente, p.email, p.telefono,
             p.medio, p.estado, p.total, p.vence_at,
             (select t.inicio from public.turnos t where t.id = p.turno_id and t.estado <> 'cancelado') as turno_inicio,
             coalesce((
               select json_agg(json_build_object('nombre', i.nombre, 'precio_unitario', i.precio_unitario, 'cantidad', i.cantidad)
                               order by i.nombre, i.id)
               from public.pedido_items i where i.pedido_id = p.id
             ), '[]'::json) as items,
             json_build_object(
               'nombre', n.nombre, 'direccion', n.direccion, 'zona_horaria', n.zona_horaria,
               'transferencia_alias', n.transferencia_alias, 'transferencia_cbu', n.transferencia_cbu,
               'transferencia_titular', n.transferencia_titular
             ) as negocio
      from public.pedidos p
      join public.negocios n on n.id = p.negocio_id
      where p.id = ${pedidoId}`),
  ).then((d) =>
    d
      ? {
          ...d,
          total: Number(d.total),
          items: d.items.map((i) => ({ ...i, precio_unitario: Number(i.precio_unitario), cantidad: Number(i.cantidad) })),
        }
      : null,
  );
}

/** Los mails de todos los dueños del negocio (como los avisos de la membresía). */
function duenosDe(negocioId: string) {
  return comoServidor((tx) =>
    tx.varios<{ email: string }>(sql`
      select u."email" as email
      from public.perfiles p
      join auth."user" u on u."id" = p.id
      where p.negocio_id = ${negocioId} and p.rol = 'dueno'`),
  );
}

/** "Recibimos tu pedido #N" al cliente, con el link y cómo pagar. */
export function notificarPedidoCliente(pedidoId: string) {
  after(async () => {
    const d = await leerPedido(pedidoId);
    if (!d || d.estado !== "pendiente") return;
    await enviarEmail(emailPedidoCliente(d.email, d));
  });
}

/** "Nuevo pedido #N" a todos los dueños. */
export function notificarPedidoNegocio(pedidoId: string) {
  after(async () => {
    const d = await leerPedido(pedidoId);
    if (!d) return;
    for (const { email } of await duenosDe(d.negocio_id)) await enviarEmail(emailPedidoNegocio(email, d));
  });
}

/** Mercado Pago confirmó el pago: comprobante al cliente y aviso a todos los dueños. */
export function notificarPagoPedido(pedidoId: string) {
  after(async () => {
    const d = await leerPedido(pedidoId);
    if (!d || d.estado !== "pagado") return;
    await enviarEmail(emailPagoPedido(d.email, d, "cliente"));
    for (const { email } of await duenosDe(d.negocio_id)) await enviarEmail(emailPagoPedido(email, d, "negocio"));
  });
}
