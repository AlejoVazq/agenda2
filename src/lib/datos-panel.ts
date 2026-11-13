import "server-only";
import { requerirPanel } from "@/lib/auth";
import { comoUsuario, sql, type Fragmento, type Tx } from "@/lib/db";
import type { EstadoPago, EstadoTurno } from "@/lib/tipos";

export type TurnoConDetalle = {
  id: string;
  inicio: string;
  fin: string;
  estado: EstadoTurno;
  precio: number | null;
  notas: string | null;
  origen: "online" | "panel";
  pago_estado: EstadoPago | null;
  nombre_reserva: string | null;
  email_reserva: string | null;
  profesional_id: string;
  servicio_id: string;
  servicio: { nombre: string; duracion_min: number } | null;
  profesional: { nombre: string; color: string } | null;
  /**
   * Datos de contacto del turno: los que se cargaron al pedirlo y, si falta
   * alguno, los de la ficha. Un empleado no lee fichas (RLS), así que para él
   * son siempre los del turno.
   */
  cliente: { id: string; nombre: string; telefono: string; email: string | null } | null;
};

/** Columnas y joins de un turno con su detalle. Corre con la sesión del usuario (RLS). */
export const SELECT_TURNO: Fragmento = sql`
  select t.id, t.inicio, t.fin, t.estado, t.precio, t.notas, t.origen, t.pago_estado,
         t.nombre_reserva, t.email_reserva, t.profesional_id, t.servicio_id,
         json_build_object('nombre', s.nombre, 'duracion_min', s.duracion_min) as servicio,
         json_build_object('nombre', p.nombre, 'color', p.color) as profesional,
         json_build_object(
           'id', t.cliente_id,
           'nombre', coalesce(t.nombre_reserva, c.nombre, 'Cliente'),
           'telefono', coalesce(t.telefono_reserva, c.telefono),
           'email', coalesce(t.email_reserva, c.email)
         ) as cliente
  from public.turnos t
  join public.servicios s on s.id = t.servicio_id
  join public.profesionales p on p.id = t.profesional_id
  left join public.clientes c on c.id = t.cliente_id`;

/**
 * Turnos en un rango [desde, hasta). RLS ya restringe: el dueño ve todo su
 * negocio y el empleado solo su agenda.
 */
export async function turnosEnRango(
  desde: Date,
  hasta: Date,
  opciones: { profesionalId?: string; incluirCancelados?: boolean } = {},
) {
  const { userId } = await requerirPanel();
  return comoUsuario(userId, (tx) => turnosEnRangoTx(tx, desde, hasta, opciones));
}

async function turnosEnRangoTx(
  tx: Tx,
  desde: Date,
  hasta: Date,
  opciones: { profesionalId?: string; incluirCancelados?: boolean },
) {
  return tx.varios<TurnoConDetalle>(sql`
    ${SELECT_TURNO}
    where t.inicio >= ${desde.toISOString()} and t.inicio < ${hasta.toISOString()}
      ${opciones.profesionalId ? sql`and t.profesional_id = ${opciones.profesionalId}` : sql``}
      ${opciones.incluirCancelados ? sql`` : sql`and t.estado <> 'cancelado'`}
    order by t.inicio`);
}

export type EventoAgenda = {
  id: string;
  tipo: "turno" | "bloqueo";
  inicio: string;
  fin: string;
  profesional_id: string;
  titulo: string;
  color: string;
  turno?: TurnoConDetalle;
};

/** Turnos y ausencias de un rango, para el calendario. RLS limita por rol. */
export async function eventosEnRango(desde: string, hasta: string, profesionalId: string | null): Promise<EventoAgenda[]> {
  const { userId } = await requerirPanel();
  const [turnos, bloqueos] = await comoUsuario(userId, async (tx) => [
    await turnosEnRangoTx(tx, new Date(desde), new Date(hasta), { profesionalId: profesionalId ?? undefined }),
    await tx.varios<{ id: string; profesional_id: string; inicio: string; fin: string; motivo: string | null }>(sql`
      select id, profesional_id, inicio, fin, motivo from public.bloqueos
      where inicio < ${hasta} and fin > ${desde}
        ${profesionalId ? sql`and profesional_id = ${profesionalId}` : sql``}`),
  ] as const);

  return [
    ...turnos.map<EventoAgenda>((t) => ({
      id: t.id,
      tipo: "turno",
      inicio: t.inicio,
      fin: t.fin,
      profesional_id: t.profesional_id,
      titulo: `${t.nombre_reserva ?? t.cliente?.nombre ?? "Cliente"} · ${t.servicio?.nombre ?? ""}`,
      color: t.profesional?.color ?? "#2f7556",
      turno: t,
    })),
    ...bloqueos.map<EventoAgenda>((b) => ({
      id: `b-${b.id}`,
      tipo: "bloqueo",
      inicio: b.inicio,
      fin: b.fin,
      profesional_id: b.profesional_id,
      titulo: b.motivo ?? "Ausencia",
      color: "#a1a1aa",
    })),
  ];
}
