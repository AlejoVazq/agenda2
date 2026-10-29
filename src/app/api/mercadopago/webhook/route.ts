import { NextResponse, type NextRequest } from "next/server";
import { procesarPagoYAvisar } from "@/lib/eventos";

// Notificaciones de Mercado Pago (webhooks e IPN). La URL incluye el negocio
// para saber con qué cuenta consultar el pago. No se confía en el contenido:
// el pago se vuelve a pedir a la API de Mercado Pago con el token de ese
// negocio, y solo se registra si es la seña de un turno de ese mismo negocio.
export const maxDuration = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function POST(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const negocioId = sp.get("negocio") ?? "";
  if (!UUID.test(negocioId)) return NextResponse.json({ ok: false }, { status: 400 });

  const cuerpo = (await request.json().catch(() => ({}))) as { type?: string; topic?: string; data?: { id?: string | number } };
  const tipo = cuerpo.type ?? cuerpo.topic ?? sp.get("type") ?? sp.get("topic");
  const pagoId = String(cuerpo.data?.id ?? sp.get("data.id") ?? sp.get("id") ?? "");

  // Solo interesan los pagos (merchant_order y otros se ignoran con 200).
  if (tipo !== "payment" || !/^\d{1,20}$/.test(pagoId)) return NextResponse.json({ ok: true });

  try {
    const resultado = await procesarPagoYAvisar(negocioId, pagoId);
    return NextResponse.json({ ok: true, resultado });
  } catch (e) {
    console.error("[mercadopago webhook]", e);
    // 500: Mercado Pago reintenta más tarde.
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
