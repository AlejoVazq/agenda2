import "server-only";
import { after } from "next/server";
import { env, integracionesDisponibles } from "@/lib/env";
import { formatFechaHora } from "@/lib/fechas";
import { comoServidor, sql } from "@/lib/db";
import { telefonoWhatsApp } from "@/lib/whatsapp";

// Fase 6: avisos automáticos por WhatsApp con la API oficial de Meta (Cloud API).
// Es una cuenta de la plataforma (no de cada negocio) y los mensajes que inicia
// un negocio tienen que usar plantillas aprobadas por Meta. Ver README.
//
// Plantillas esperadas (idioma es_AR), con estos parámetros en el cuerpo:
//   WHATSAPP_PLANTILLA_CONFIRMACION: {{1}} cliente, {{2}} negocio, {{3}} servicio, {{4}} fecha y hora, {{5}} link
//   WHATSAPP_PLANTILLA_RECORDATORIO: {{1}} cliente, {{2}} negocio, {{3}} servicio, {{4}} fecha y hora, {{5}} link

export type DatosAvisoWhatsApp = {
  telefono: string;
  cliente: string;
  negocio: string;
  servicio: string;
  inicio: string;
  zona_horaria: string;
  token: string;
};

export async function enviarPlantillaWhatsApp(
  tipo: "confirmacion" | "recordatorio",
  d: DatosAvisoWhatsApp,
): Promise<{ ok: boolean; omitido?: boolean }> {
  const plantilla =
    tipo === "confirmacion" ? process.env.WHATSAPP_PLANTILLA_CONFIRMACION : process.env.WHATSAPP_PLANTILLA_RECORDATORIO;
  const token = process.env.WHATSAPP_TOKEN;
  const telefonoId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!plantilla || !token || !telefonoId) {
    console.info(`[whatsapp omitido: falta configuración] ${tipo} para=${d.telefono}`);
    return { ok: true, omitido: true };
  }

  const parametros = [
    d.cliente.split(" ")[0],
    d.negocio,
    d.servicio,
    formatFechaHora(d.inicio, d.zona_horaria),
    `${env.siteUrl}/t/${d.token}`,
  ].map((text) => ({ type: "text", text }));

  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${telefonoId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: telefonoWhatsApp(d.telefono),
        type: "template",
        template: {
          name: plantilla,
          language: { code: process.env.WHATSAPP_IDIOMA ?? "es_AR" },
          components: [{ type: "body", parameters: parametros }],
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) {
      console.error(`[whatsapp] ${tipo} respondió ${r.status}: ${(await r.text().catch(() => "")).slice(0, 300)}`);
      return { ok: false };
    }
    return { ok: true };
  } catch (e) {
    console.error("[whatsapp] error de red", e);
    return { ok: false };
  }
}

/** Confirmación por WhatsApp después de responder, si el negocio la activó. */
export function confirmarPorWhatsAppDespues(turnoId: string) {
  if (!integracionesDisponibles().whatsapp || !process.env.WHATSAPP_PLANTILLA_CONFIRMACION) return;
  after(async () => {
    const t = await comoServidor((tx) =>
      tx.uno<{
        token_cancelacion: string;
        inicio: string;
        estado: string;
        servicio: { nombre: string } | null;
        cliente: { nombre: string; telefono: string } | null;
        negocio: { nombre: string; zona_horaria: string; whatsapp_avisos: boolean } | null;
      }>(sql`
        select t.token_cancelacion, t.inicio, t.estado,
               json_build_object('nombre', s.nombre) as servicio,
               json_build_object(
                 'nombre', coalesce(t.nombre_reserva, c.nombre),
                 'telefono', coalesce(t.telefono_reserva, c.telefono)
               ) as cliente,
               json_build_object('nombre', n.nombre, 'zona_horaria', n.zona_horaria, 'whatsapp_avisos', n.whatsapp_avisos) as negocio
        from public.turnos t
        join public.servicios s on s.id = t.servicio_id
        join public.clientes c on c.id = t.cliente_id
        join public.negocios n on n.id = t.negocio_id
        where t.id = ${turnoId}`),
    );
    if (!t?.negocio?.whatsapp_avisos || !t.cliente || t.estado === "cancelado") return;
    await enviarPlantillaWhatsApp("confirmacion", {
      telefono: t.cliente.telefono,
      cliente: t.cliente.nombre,
      negocio: t.negocio.nombre,
      servicio: t.servicio?.nombre ?? "",
      inicio: t.inicio,
      zona_horaria: t.negocio.zona_horaria,
      token: t.token_cancelacion,
    });
  });
}
