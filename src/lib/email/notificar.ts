import "server-only";
import { after } from "next/server";
import { crearSupabaseServidor } from "@/lib/supabase/server";
import { enviarEmail } from "./enviar";
import { emailCambioPorNegocio } from "./plantillas";

/**
 * Avisa al cliente (si dejó email) que el negocio canceló o movió su turno.
 * Lee el turno con la sesión del usuario del panel (RLS) y envía después de
 * responder, para no demorar la acción.
 */
export async function notificarCambioTurno(turnoId: string, tipo: "cancelado" | "reprogramado") {
  const supabase = await crearSupabaseServidor();
  const { data } = await supabase
    .from("turnos")
    .select(
      "token_cancelacion, inicio, fin, precio, estado, servicio:servicios(nombre), profesional:profesionales(nombre), cliente:clientes(nombre, email), negocio:negocios(nombre, direccion, telefono, zona_horaria, cancelacion_min_horas)",
    )
    .eq("id", turnoId)
    .maybeSingle();

  const t = data as unknown as {
    token_cancelacion: string;
    inicio: string;
    fin: string;
    precio: number | null;
    estado: string;
    servicio: { nombre: string } | null;
    profesional: { nombre: string } | null;
    cliente: { nombre: string; email: string | null } | null;
    negocio: {
      nombre: string;
      direccion: string | null;
      telefono: string | null;
      zona_horaria: string;
      cancelacion_min_horas: number;
    } | null;
  } | null;
  if (!t?.cliente?.email || !t.negocio) return;
  // No avisar cambios de turnos que ya pasaron.
  if (new Date(t.fin) < new Date()) return;

  const email = emailCambioPorNegocio(
    t.cliente.email,
    {
      token: t.token_cancelacion,
      inicio: t.inicio,
      fin: t.fin,
      cliente: t.cliente.nombre,
      servicio: t.servicio?.nombre ?? "",
      profesional: t.profesional?.nombre ?? "",
      precio: t.precio,
      estado: t.estado,
      negocio: t.negocio,
      cancelacion_min_horas: t.negocio.cancelacion_min_horas,
    },
    tipo,
  );
  after(() => enviarEmail(email));
}
