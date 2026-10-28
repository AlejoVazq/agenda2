import "server-only";
import { crearSupabaseServidor } from "@/lib/supabase/server";
import type { EstadoTurno } from "@/lib/tipos";

export type TurnoConDetalle = {
  id: string;
  inicio: string;
  fin: string;
  estado: EstadoTurno;
  precio: number | null;
  notas: string | null;
  origen: "online" | "panel";
  profesional_id: string;
  servicio_id: string;
  servicio: { nombre: string; duracion_min: number } | null;
  profesional: { nombre: string; color: string } | null;
  cliente: { id: string; nombre: string; telefono: string; email: string | null } | null;
};

const SELECT_TURNO =
  "id, inicio, fin, estado, precio, notas, origen, profesional_id, servicio_id, servicio:servicios(nombre, duracion_min), profesional:profesionales(nombre, color), cliente:clientes(id, nombre, telefono, email)";

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
