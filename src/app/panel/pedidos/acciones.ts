"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sesionParaAccion } from "@/lib/auth";
import { comoUsuario, sql, type Fragmento } from "@/lib/db";
import { notificarPedidoCancelado } from "@/lib/email/notificar";
import { mensajeDeError } from "@/lib/errores";
import { MENSAJE_SOLO_LECTURA } from "@/lib/suscripcion";
import type { EstadoAccion } from "@/lib/tipos";

// Acciones del dueño sobre un pedido. Las funciones de la base verifican dueño, negocio
// habilitado y el estado del pedido (ESTADO_INVALIDO si ya cambió).

async function ejecutar(id: string, consulta: (id: string) => Fragmento, mensaje: string): Promise<EstadoAccion> {
  const sesion = await sesionParaAccion({ soloDueno: true });
  if (!sesion) return { error: "Solo el dueño del negocio puede manejar los pedidos." };
  if (!sesion.habilitado) return { error: MENSAJE_SOLO_LECTURA };
  if (!z.uuid().safeParse(id).success) return { error: "Pedido inválido." };

  try {
    await comoUsuario(sesion.userId, (tx) => tx.ejecutar(consulta(id)));
  } catch (e) {
    return { error: mensajeDeError(e) };
  }
  revalidatePath("/panel", "layout");
  return { ok: true, mensaje };
}

/** Pago recibido (transferencia o efectivo). Un pedido vencido se reactiva si hay stock. */
export async function marcarPedidoPagado(id: string): Promise<EstadoAccion> {
  return ejecutar(id, (p) => sql`select public.pedido_marcar_pagado(${p})`, "Pedido marcado como pagado.");
}

/** Lo retiró (si no estaba pagado, se cobró al entregar). */
export async function marcarPedidoEntregado(id: string): Promise<EstadoAccion> {
  return ejecutar(id, (p) => sql`select public.pedido_marcar_entregado(${p})`, "Pedido marcado como entregado.");
}

/** Cancela un pedido sin entregar: vuelve el stock y se avisa al cliente por mail. */
export async function cancelarPedido(id: string): Promise<EstadoAccion> {
  const r = await ejecutar(id, (p) => sql`select public.pedido_cancelar(${p})`, "Pedido cancelado. Le avisamos al cliente por mail.");
  if (r.ok) notificarPedidoCancelado(id);
  return r;
}

/** La plata de un pago que no se pudo usar ya se devolvió. */
export async function marcarPedidoDevuelto(id: string): Promise<EstadoAccion> {
  return ejecutar(id, (p) => sql`select public.pedido_marcar_devuelto(${p})`, "Listo, quedó como devuelto.");
}
