"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { mensajeDeError } from "@/lib/errores";
import { crearPagoPedido } from "@/lib/mercadopago";
import { cancelarPedidoCliente, pedidoDeToken } from "@/lib/pedidos";
import type { EstadoAccion } from "@/lib/tipos";
import { token as esquemaToken } from "@/lib/validaciones";

/** El cliente cancela su pedido mientras no está pagado (el stock vuelve). */
export async function cancelarPedido(token: string, _prev: EstadoAccion): Promise<EstadoAccion> {
  if (!esquemaToken.safeParse(token).success) return { error: "No encontramos el pedido." };
  let cancelado: boolean;
  try {
    cancelado = await cancelarPedidoCliente(token);
  } catch (e) {
    return { error: mensajeDeError(e) };
  }
  revalidatePath(`/p/${token}`);
  if (!cancelado) return { error: "Este pedido ya no se puede cancelar. Recargá la página." };
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
