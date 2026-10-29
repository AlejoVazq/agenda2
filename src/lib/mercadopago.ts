import "server-only";
import { env } from "@/lib/env";
import { offsetZona } from "@/lib/fechas";
import { buscarIntegracion, leerSecreto } from "@/lib/integraciones";
import { crearSupabaseAdmin } from "@/lib/supabase/admin";

// Fase 6: seña con Mercado Pago (Checkout Pro). Cada negocio conecta su propia
// cuenta con su Access Token; el dinero va directo a esa cuenta.
//
// Flujo: crear_reserva deja el turno retenido (pago_estado = 'pendiente') →
// el cliente paga en Mercado Pago → el webhook (o la vuelta a /t/<token>)
// consulta el pago en la API de Mercado Pago con el token del negocio y recién
// entonces lo registra. Nunca se confía en los parámetros que llegan por URL.

const API = "https://api.mercadopago.com";

export type ConfigMercadoPago = {
  usuario_id: number;
  nickname: string;
  email: string | null;
  modo: "prueba" | "produccion";
};
type SecretoMercadoPago = { access_token: string };

export type ResultadoPago = "confirmado" | "pendiente" | "ya_procesado" | "rechazado" | "reembolsar" | "en_proceso";

/** Verifica un Access Token y devuelve los datos de la cuenta. */
export async function verificarTokenMercadoPago(accessToken: string): Promise<ConfigMercadoPago> {
  const r = await fetch(`${API}/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (r.status === 401 || r.status === 403) throw new Error("Mercado Pago no reconoció ese Access Token.");
  if (!r.ok) throw new Error("No pudimos comunicarnos con Mercado Pago. Probá de nuevo en un rato.");
  const u = (await r.json()) as { id: number; nickname?: string; email?: string };
  return {
    usuario_id: u.id,
    nickname: u.nickname ?? String(u.id),
    email: u.email ?? null,
    modo: accessToken.startsWith("TEST-") ? "prueba" : "produccion",
  };
}

async function accesoNegocio(negocioId: string) {
  const integracion = await buscarIntegracion<ConfigMercadoPago>(negocioId, "mercadopago");
  if (!integracion || integracion.estado !== "activa") return null;
  const secreto = await leerSecreto<SecretoMercadoPago>(integracion.id);
  if (!secreto) return null;
  return { token: secreto.access_token, integracion };
}

/** Fecha en el formato que pide Mercado Pago: 2026-10-28T12:00:00.000-03:00. */
function fechaMP(instante: Date) {
  const offset = offsetZona(instante, "America/Argentina/Buenos_Aires");
  const [h, m] = offset.slice(1).split(":").map(Number);
  const signo = offset.startsWith("-") ? -1 : 1;
  const local = new Date(instante.getTime() + signo * (h * 60 + m) * 60_000);
  return `${local.toISOString().slice(0, 23)}${offset}`;
}

/**
 * Crea la preferencia de pago de la seña de un turno retenido y devuelve la URL
 * de Mercado Pago a la que hay que mandar al cliente (o null si no corresponde).
 */
export async function crearPagoSena(turnoId: string): Promise<string | null> {
  const admin = crearSupabaseAdmin();
  const { data } = await admin
    .from("turnos")
    .select(
      "id, negocio_id, token_cancelacion, sena_monto, pago_estado, pago_vence_at, estado, servicio:servicios(nombre), cliente:clientes(nombre, email), negocio:negocios(nombre)",
    )
    .eq("id", turnoId)
    .maybeSingle();
  const t = data as unknown as {
    id: string;
    negocio_id: string;
    token_cancelacion: string;
    sena_monto: number | null;
    pago_estado: string | null;
    pago_vence_at: string | null;
    estado: string;
    servicio: { nombre: string } | null;
    cliente: { nombre: string; email: string | null } | null;
    negocio: { nombre: string } | null;
  } | null;
  if (!t || t.pago_estado !== "pendiente" || !t.sena_monto || !t.pago_vence_at) return null;
  if (t.estado === "cancelado") return null;
  const vence = new Date(t.pago_vence_at);
  if (vence.getTime() < Date.now() + 60_000) return null;

  const acceso = await accesoNegocio(t.negocio_id);
  if (!acceso) return null;

  const https = env.siteUrl.startsWith("https://");
  const vuelta = `${env.siteUrl}/t/${t.token_cancelacion}`;
  const preferencia = {
    items: [
      {
        id: t.id,
        title: `Seña: ${t.servicio?.nombre ?? "turno"} - ${t.negocio?.nombre ?? ""}`.slice(0, 250),
        quantity: 1,
        unit_price: Number(t.sena_monto),
        currency_id: "ARS",
      },
    ],
    payer: { name: t.cliente?.nombre, ...(t.cliente?.email ? { email: t.cliente.email } : {}) },
    external_reference: t.id,
    back_urls: { success: vuelta, pending: vuelta, failure: vuelta },
    // Mercado Pago solo acepta auto_return y notificaciones con URLs públicas https.
    ...(https
      ? { auto_return: "approved", notification_url: `${env.siteUrl}/api/mercadopago/webhook?negocio=${t.negocio_id}` }
      : {}),
    // Aprobado o rechazado al instante: sin pagos "pendientes" (efectivo) que no
    // llegarían a tiempo para la retención del turno.
    binary_mode: true,
    expires: true,
    expiration_date_to: fechaMP(vence),
    metadata: { turno_id: t.id },
  };

  const r = await fetch(`${API}/checkout/preferences`, {
    method: "POST",
    headers: { Authorization: `Bearer ${acceso.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(preferencia),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) {
    console.error("[mercadopago] preferencia", r.status, (await r.text().catch(() => "")).slice(0, 300));
    return null;
  }
  const cuerpo = (await r.json()) as { init_point?: string; sandbox_init_point?: string };
  return (acceso.integracion.config.modo === "prueba" ? cuerpo.sandbox_init_point : null) ?? cuerpo.init_point ?? null;
}

/**
 * Consulta un pago en Mercado Pago (con el token del negocio) y, si es la seña
 * de un turno de ese negocio, lo registra. Idempotente: se puede llamar desde
 * el webhook y desde la página de vuelta sin duplicar nada.
 */
export async function procesarPago(
  negocioId: string,
  pagoId: string,
  turnoEsperado?: string,
): Promise<{ resultado: ResultadoPago; turnoId: string } | null> {
  if (!/^\d{1,20}$/.test(pagoId)) return null;
  const acceso = await accesoNegocio(negocioId);
  if (!acceso) return null;

  const r = await fetch(`${API}/v1/payments/${pagoId}`, {
    headers: { Authorization: `Bearer ${acceso.token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) {
    console.error("[mercadopago] pago", pagoId, r.status);
    return null;
  }
  const pago = (await r.json()) as {
    id: number;
    status: string;
    external_reference?: string | null;
    transaction_amount?: number;
    currency_id?: string;
  };

  const turnoId = pago.external_reference ?? "";
  if (!/^[0-9a-f-]{36}$/.test(turnoId)) return null;
  if (turnoEsperado && turnoEsperado !== turnoId) return null;

  const admin = crearSupabaseAdmin();
  const { data: turno } = await admin.from("turnos").select("id").eq("id", turnoId).eq("negocio_id", negocioId).maybeSingle();
  if (!turno) return null;

  if (pago.status === "pending" || pago.status === "in_process" || pago.status === "authorized") {
    return { resultado: "en_proceso", turnoId };
  }

  const aprobado = pago.status === "approved" && pago.currency_id === "ARS";
  const { data, error } = await admin.rpc("registrar_pago", {
    p_turno_id: turnoId,
    p_pago_id: String(pago.id),
    p_aprobado: aprobado,
    p_monto: pago.transaction_amount ?? 0,
  });
  if (error) throw error;
  return { resultado: data as ResultadoPago, turnoId };
}
