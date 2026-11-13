"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { comoAnonimo, comoServidor, sql } from "@/lib/db";
import { notificarCancelacionCliente } from "@/lib/email/notificar";
import { sincronizarGoogleDespues } from "@/lib/google";
import { crearPagoSena } from "@/lib/mercadopago";
import { mensajeDeError } from "@/lib/errores";
import { token as esquemaToken } from "@/lib/validaciones";
import type { EstadoAccion } from "@/lib/tipos";

/** Id del turno de un token (consulta fija: quien tiene el token ya ve el turno). */
async function turnoIdDeToken(token: string) {
  const fila = await comoServidor((tx) =>
    tx.uno<{ id: string }>(sql`select id from public.turnos where token_cancelacion = ${token}`),
  );
  return fila?.id ?? null;
}

export async function cancelarTurno(token: string, _prev: EstadoAccion): Promise<EstadoAccion> {
  if (!esquemaToken.safeParse(token).success) return { error: "No encontramos el turno." };

  try {
    // La función valida estado y política de cancelación del negocio.
    await comoAnonimo((tx) => tx.ejecutar(sql`select public.cancelar_turno_cliente(${token})`));
  } catch (e) {
    return { error: mensajeDeError(e) };
  }

  const id = await turnoIdDeToken(token);
  if (id) {
    sincronizarGoogleDespues(id);
    notificarCancelacionCliente(id);
  }

  revalidatePath(`/t/${token}`);
  return { ok: true, mensaje: "Tu turno fue cancelado." };
}

/** Reintentar el pago de la seña (si Mercado Pago falló o el cliente volvió sin pagar). */
export async function pagarSena(token: string, _prev: EstadoAccion): Promise<EstadoAccion> {
  if (!esquemaToken.safeParse(token).success) return { error: "No encontramos el turno." };
  const id = await turnoIdDeToken(token);
  if (!id) return { error: "No encontramos el turno." };

  const url = await crearPagoSena(id).catch(() => null);
  if (!url) {
    return { error: "No pudimos iniciar el pago. Puede que haya vencido el plazo: recargá la página o comunicate con el negocio." };
  }
  redirect(url);
}
