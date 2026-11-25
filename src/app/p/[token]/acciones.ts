"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { notificarPedidoAlDueno } from "@/lib/email/notificar";
import { mensajeDeError } from "@/lib/errores";
import { crearPagoPedido } from "@/lib/mercadopago";
import { cancelarPedidoCliente, pedidoDeToken } from "@/lib/pedidos";
import type { EstadoAccion } from "@/lib/tipos";
import { token as esquemaToken } from "@/lib/validaciones";

/**
 * El cliente cancela su pedido mientras no está pagado (el stock vuelve). Si los dueños
 * ya tenían el aviso de "Nuevo pedido" (transferencia o efectivo; uno de Mercado Pago sin
 * pagar nunca les llegó), se les avisa que se canceló.
 */
export async function cancelarPedido(token: string, _prev: EstadoAccion): Promise<EstadoAccion> {
  if (!esquemaToken.safeParse(token).success) return { error: "No encontramos el pedido." };
  const pedido = await pedidoDeToken(token);
  let cancelado: boolean;
  try {
    cancelado = await cancelarPedidoCliente(token);
  } catch (e) {
    return { error: mensajeDeError(e) };
  }
  revalidatePath(`/p/${token}`);
  if (!cancelado) return { error: "Este pedido ya no se puede cancelar. Recargá la página." };
  if (pedido && pedido.medio !== "mercadopago") notificarPedidoAlDueno(pedido.id, "cancelado_cliente");
  return { ok: true, mensaje: "Tu pedido fue cancelado." };
}

/** Reintentar el pago con Mercado Pago (si falló o el cliente volvió sin pagar). */
export async function pagarPedido(token: string, _prev: EstadoAccion): Promise<EstadoAccion> {
  if (!esquemaToken.safeParse(token).success) return { error: "No encontramos el pedido." };
  const pedido = await pedidoDeToken(token);
  if (!pedido) return { error: "No encontramos el pedido." };

  const url = await crearPagoPedido(pedido.id).catch(() => null);
  if (!url) {
    return { error: "No pudimos iniciar el pago. Puede que haya vencido el plazo: recargá la página o comunicate con el negocio." };
  }
  redirect(url);
}
