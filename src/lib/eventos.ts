import "server-only";
import {
  notificarConfirmacionCliente,
  notificarNuevaReserva,
  notificarPagoPedido,
  notificarPedidoCliente,
  notificarPedidoNegocio,
} from "@/lib/email/notificar";
import { sincronizarGoogleDespues } from "@/lib/google";
import { procesarPago } from "@/lib/mercadopago";
import type { MedioPago } from "@/lib/tipos";
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
 * Entró un pedido de la tienda. El cliente recibe siempre "Recibimos tu pedido" (con el
 * link para pagar o ver cómo hacerlo). Los dueños reciben "Nuevo pedido" solo si es por
 * transferencia o efectivo: uno de Mercado Pago les llega recién cuando se acredita el
 * pago ("Pago recibido", desde `procesarPagoYAvisar`), así no avisa carritos sin pagar.
 * Todo por `after()`.
 */
export function trasPedidoNuevo(pedidoId: string, medio: MedioPago) {
  notificarPedidoCliente(pedidoId);
  if (medio !== "mercadopago") notificarPedidoNegocio(pedidoId);
}

/**
 * Verifica un pago contra Mercado Pago, lo registra y dispara los avisos una
 * sola vez (si el webhook y la vuelta del cliente llegan juntos, el segundo
 * recibe "ya_procesado" y no repite nada). `esperado`: el id del turno o del
 * pedido de la página de vuelta.
 */
export async function procesarPagoYAvisar(negocioId: string, pagoId: string, esperado?: string) {
  const r = await procesarPago(negocioId, pagoId, esperado);
  if (!r) return null;
  if (r.tipo === "pedido") {
    if (r.resultado === "confirmado") notificarPagoPedido(r.id);
    return r.resultado;
  }
  if (r.resultado === "confirmado" || r.resultado === "pendiente") trasReservaFirme(r.id);
  if (r.resultado === "reembolsar") sincronizarGoogleDespues(r.id);
  return r.resultado;
}
