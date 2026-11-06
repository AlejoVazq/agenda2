import "server-only";
import { crearSupabaseServidor } from "@/lib/supabase/server";
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
  profesional_id: string;
  servicio_id: string;
  servicio: { nombre: string; duracion_min: number } | null;
  profesional: { nombre: string; color: string } | null;
  cliente: { id: string; nombre: string; telefono: string; email: string | null } | null;
};

const SELECT_TURNO =
  "id, inicio, fin, estado, precio, notas, origen, pago_estado, profesional_id, servicio_id, servicio:servicios(nombre, duracion_min), profesional:profesionales(nombre, color), cliente:clientes(id, nombre, telefono, email)";

/**
 * Turnos en un rango [desde, hasta). RLS ya restringe: el dueño ve todo su
 * negocio y el empleado solo su agenda.
 */
export async function turnosEnRango(
  desde: Date,
  hasta: Date,
  opciones: { profesionalId?: string; incluirCancelados?: boolean } = {},
) {
  const supabase = await crearSupabaseServidor();
  let consulta = supabase
    .from("turnos")
    .select(SELECT_TURNO)
    .gte("inicio", desde.toISOString())
    .lt("inicio", hasta.toISOString())
    .order("inicio");
  if (opciones.profesionalId) consulta = consulta.eq("profesional_id", opciones.profesionalId);
  if (!opciones.incluirCancelados) consulta = consulta.neq("estado", "cancelado");
  const { data, error } = await consulta;
  if (error) throw error;
  return (data ?? []) as unknown as TurnoConDetalle[];
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
  const supabase = await crearSupabaseServidor();
  let consultaBloqueos = supabase
    .from("bloqueos")
    .select("id, profesional_id, inicio, fin, motivo")
    .lt("inicio", hasta)
    .gt("fin", desde);
  if (profesionalId) consultaBloqueos = consultaBloqueos.eq("profesional_id", profesionalId);

  const [turnos, { data: bloqueos }] = await Promise.all([
    turnosEnRango(new Date(desde), new Date(hasta), { profesionalId: profesionalId ?? undefined }),
    consultaBloqueos,
  ]);

  return [
    ...turnos.map<EventoAgenda>((t) => ({
      id: t.id,
      tipo: "turno",
      inicio: t.inicio,
      fin: t.fin,
      profesional_id: t.profesional_id,
      titulo: `${t.cliente?.nombre ?? "Cliente"} · ${t.servicio?.nombre ?? ""}`,
      color: t.profesional?.color ?? "#7434ee",
      turno: t,
    })),
    ...(bloqueos ?? []).map<EventoAgenda>((b) => ({
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
