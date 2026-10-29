import "server-only";
import { notificarConfirmacionCliente, notificarNuevaReserva } from "@/lib/email/notificar";
import { sincronizarGoogleDespues } from "@/lib/google";
import { procesarPago } from "@/lib/mercadopago";
import { confirmarPorWhatsAppDespues } from "@/lib/whatsapp-api";

/**
 * Una reserva online quedó firme (sin seña, o con la seña ya pagada): avisar
 * al cliente y al negocio, y reflejarla en Google Calendar. Todo corre después
 * de responder, así no demora al cliente.
 */
export function trasReservaFirme(turnoId: string) {
  notificarConfirmacionCliente(turnoId);
  notificarNuevaReserva(turnoId);
  confirmarPorWhatsAppDespues(turnoId);
  sincronizarGoogleDespues(turnoId);
}

/**
 * Verifica un pago contra Mercado Pago, lo registra y dispara los avisos una
 * sola vez (si el webhook y la vuelta del cliente llegan juntos, el segundo
 * recibe "ya_procesado" y no repite nada).
 */
export async function procesarPagoYAvisar(negocioId: string, pagoId: string, turnoEsperado?: string) {
  const r = await procesarPago(negocioId, pagoId, turnoEsperado);
  if (!r) return null;
  if (r.resultado === "confirmado" || r.resultado === "pendiente") trasReservaFirme(r.turnoId);
  if (r.resultado === "reembolsar") sincronizarGoogleDespues(r.turnoId);
  return r.resultado;
}
