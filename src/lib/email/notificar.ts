import "server-only";
import { after } from "next/server";
import { crearSupabaseServidor } from "@/lib/supabase/server";
import { crearSupabaseAdmin } from "@/lib/supabase/admin";
import { enviarEmail } from "./enviar";
import { emailCambioPorNegocio, emailNuevaReserva } from "./plantillas";

/**
 * Avisa al dueño (y al empleado de esa agenda, si tiene usuario) que entró una
 * reserva online. Corre después de responder al cliente. Usa service role
 * porque quien reserva es anónimo; la consulta es fija y no depende del input.
 */
export function notificarNuevaReserva(turnoId: string) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.RESEND_API_KEY) return;

  after(async () => {
    const admin = crearSupabaseAdmin();
    const { data } = await admin
      .from("turnos")
      .select(
        "id, inicio, estado, negocio_id, profesional_id, servicio:servicios(nombre), profesional:profesionales(nombre), cliente:clientes(nombre, telefono), negocio:negocios(nombre, zona_horaria)",
      )
      .eq("id", turnoId)
      .maybeSingle();
    const t = data as unknown as {
      id: string;
      inicio: string;
      estado: string;
      negocio_id: string;
      profesional_id: string;
      servicio: { nombre: string } | null;
      profesional: { nombre: string } | null;
      cliente: { nombre: string; telefono: string } | null;
      negocio: { nombre: string; zona_horaria: string } | null;
    } | null;
    if (!t?.negocio || !t.cliente) return;

    const { data: perfiles } = await admin
      .from("perfiles")
      .select("id, rol, profesional_id")
      .eq("negocio_id", t.negocio_id);
    const destinatarios = (perfiles ?? []).filter((p) => p.rol === "dueno" || p.profesional_id === t.profesional_id);

    for (const p of destinatarios) {
      const { data: usuario } = await admin.auth.admin.getUserById(p.id);
      const email = usuario.user?.email;
      if (!email) continue;
      await enviarEmail(
        emailNuevaReserva(email, {
          turnoId: t.id,
          inicio: t.inicio,
          cliente: t.cliente.nombre,
          telefono: t.cliente.telefono,
          servicio: t.servicio?.nombre ?? "",
          profesional: t.profesional?.nombre ?? "",
          pendiente: t.estado === "pendiente",
          negocio: t.negocio.nombre,
          zona_horaria: t.negocio.zona_horaria,
        }),
      );
    }
  });
}

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
