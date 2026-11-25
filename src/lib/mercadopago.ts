import "server-only";
import { env } from "@/lib/env";
import { offsetZona } from "@/lib/fechas";
import { buscarIntegracion, leerSecreto } from "@/lib/integraciones";
import { comoServidor, sql } from "@/lib/db";

// Fase 6: seña con Mercado Pago (Checkout Pro). Cada negocio conecta su propia
// cuenta con su Access Token; el dinero va directo a esa cuenta. Desde 2026-11-24 la
// seña está apagada (SENA_ACTIVA) y Mercado Pago cobra los pedidos de la tienda
// (external_reference "pedido:<id>"); el camino de la seña queda igual.
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
  const t = await comoServidor((tx) =>
    tx.uno<{
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
    }>(sql`
      select t.id, t.negocio_id, t.token_cancelacion, t.sena_monto, t.pago_estado, t.pago_vence_at, t.estado,
             json_build_object('nombre', s.nombre) as servicio,
             json_build_object('nombre', coalesce(t.nombre_reserva, c.nombre), 'email', coalesce(t.email_reserva, c.email)) as cliente,
             json_build_object('nombre', n.nombre) as negocio
      from public.turnos t
      join public.servicios s on s.id = t.servicio_id
      left join public.clientes c on c.id = t.cliente_id
      join public.negocios n on n.id = t.negocio_id
      where t.id = ${turnoId}`),
  );
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
 * Crea la preferencia de pago de un pedido de la tienda (pendiente, con Mercado Pago) y
 * devuelve la URL a la que hay que mandar al cliente, o null si no corresponde (ya no
 * está pendiente, no es de Mercado Pago, vence en menos de un minuto o MP no respondió).
 */
export async function crearPagoPedido(pedidoId: string): Promise<string | null> {
  const p = await comoServidor((tx) =>
    tx.uno<{
      id: string;
      negocio_id: string;
      token: string;
      numero: number;
      nombre: string | null;
      email: string;
      medio: string;
      estado: string;
      vence_at: string | null;
      negocio: string;
      items: { nombre: string; precio_unitario: number; cantidad: number }[];
    }>(sql`
      select p.id, p.negocio_id, p.token, p.numero, p.nombre, p.email, p.medio, p.estado, p.vence_at,
             n.nombre as negocio,
             coalesce((
               select json_agg(json_build_object('nombre', i.nombre, 'precio_unitario', i.precio_unitario, 'cantidad', i.cantidad)
                               order by i.nombre, i.id)
               from public.pedido_items i where i.pedido_id = p.id
             ), '[]'::json) as items
      from public.pedidos p
      join public.negocios n on n.id = p.negocio_id
      where p.id = ${pedidoId}`),
  );
  if (!p || p.estado !== "pendiente" || p.medio !== "mercadopago" || !p.vence_at || p.items.length === 0) return null;
  const vence = new Date(p.vence_at);
  if (vence.getTime() < Date.now() + 60_000) return null;

  const acceso = await accesoNegocio(p.negocio_id);
  if (!acceso) return null;

  const https = env.siteUrl.startsWith("https://");
  const vuelta = `${env.siteUrl}/p/${p.token}`;
  const preferencia = {
    items: p.items.map((i, n) => ({
      id: `${p.id}-${n + 1}`,
      title: i.nombre.slice(0, 250),
      quantity: Number(i.cantidad),
      unit_price: Number(i.precio_unitario),
      currency_id: "ARS",
    })),
    payer: { ...(p.nombre ? { name: p.nombre } : {}), email: p.email },
    external_reference: `pedido:${p.id}`,
    back_urls: { success: vuelta, pending: vuelta, failure: vuelta },
    // Mercado Pago solo acepta auto_return y notificaciones con URLs públicas https.
    ...(https
      ? { auto_return: "approved", notification_url: `${env.siteUrl}/api/mercadopago/webhook?negocio=${p.negocio_id}` }
      : {}),
    // Aprobado o rechazado al instante, y sin medios en efectivo (Rapipago, Pago Fácil,
    // cajero) que no llegarían a acreditarse antes de que venza el pedido.
    binary_mode: true,
    payment_methods: { excluded_payment_types: [{ id: "ticket" }, { id: "atm" }] },
    expires: true,
    expiration_date_to: fechaMP(vence),
    metadata: { pedido_id: p.id, numero: p.numero },
  };

  const r = await fetch(`${API}/checkout/preferences`, {
    method: "POST",
    headers: { Authorization: `Bearer ${acceso.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(preferencia),
    signal: AbortSignal.timeout(15_000),
  }).catch((e) => {
    console.error("[mercadopago] preferencia de pedido", e);
    return null;
  });
  if (!r) return null;
  if (!r.ok) {
    console.error("[mercadopago] preferencia de pedido", r.status, (await r.text().catch(() => "")).slice(0, 300));
    return null;
  }
  const cuerpo = (await r.json()) as { init_point?: string; sandbox_init_point?: string };
  return (acceso.integracion.config.modo === "prueba" ? cuerpo.sandbox_init_point : null) ?? cuerpo.init_point ?? null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Qué pagó: la seña de un turno (uuid suelto) o un pedido ("pedido:<uuid>"). */
function referenciaDePago(ref: string | null | undefined): { tipo: "turno" | "pedido"; id: string } | null {
  const r = ref ?? "";
  if (r.startsWith("pedido:")) {
    const id = r.slice("pedido:".length);
    return UUID.test(id) ? { tipo: "pedido", id } : null;
  }
  return UUID.test(r) ? { tipo: "turno", id: r } : null;
}

/**
 * Consulta un pago en Mercado Pago (con el token del negocio) y, si es la seña de un
 * turno o el pago de un pedido de ese negocio, lo registra. Idempotente: se puede
 * llamar desde el webhook y desde la página de vuelta sin duplicar nada. `esperado` (el
 * id del turno o del pedido de la página de vuelta) evita registrar un pago ajeno.
 */
export async function procesarPago(
  negocioId: string,
  pagoId: string,
  esperado?: string,
): Promise<{ resultado: ResultadoPago; tipo: "turno" | "pedido"; id: string } | null> {
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

  const ref = referenciaDePago(pago.external_reference);
  if (!ref) return null;
  if (esperado && esperado !== ref.id) return null;
  const { tipo, id } = ref;

  const existe = await comoServidor((tx) =>
    tipo === "pedido"
      ? tx.uno(sql`select id from public.pedidos where id = ${id} and negocio_id = ${negocioId}`)
      : tx.uno(sql`select id from public.turnos where id = ${id} and negocio_id = ${negocioId}`),
  );
  if (!existe) return null;

  if (pago.status === "pending" || pago.status === "in_process" || pago.status === "authorized") {
    return { resultado: "en_proceso", tipo, id };
  }

  const aprobado = pago.status === "approved" && pago.currency_id === "ARS";
  const monto = pago.transaction_amount ?? 0;
  const fila = await comoServidor((tx) =>
    tipo === "pedido"
      ? tx.uno<{ r: ResultadoPago }>(sql`select public.registrar_pago_pedido(${id}, ${String(pago.id)}, ${aprobado}, ${monto}) as r`)
      : tx.uno<{ r: ResultadoPago }>(sql`select public.registrar_pago(${id}, ${String(pago.id)}, ${aprobado}, ${monto}) as r`),
  );
  return { resultado: fila!.r, tipo, id };
}
