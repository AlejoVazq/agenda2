"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sincronizarGoogleDespues } from "@/lib/google";
import { crearPagoSena } from "@/lib/mercadopago";
import { crearSupabaseAdmin } from "@/lib/supabase/admin";
import { crearSupabaseServidor } from "@/lib/supabase/server";
import { mensajeDeError } from "@/lib/errores";
import { token as esquemaToken } from "@/lib/validaciones";
import type { EstadoAccion } from "@/lib/tipos";

async function turnoIdDeToken(token: string) {
  const admin = crearSupabaseAdmin();
  const { data } = await admin.from("turnos").select("id").eq("token_cancelacion", token).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export async function cancelarTurno(token: string, _prev: EstadoAccion): Promise<EstadoAccion> {
  if (!esquemaToken.safeParse(token).success) return { error: "No encontramos el turno." };

  const supabase = await crearSupabaseServidor();
  // La función valida estado y política de cancelación del negocio.
  const { error } = await supabase.rpc("cancelar_turno_cliente", { p_token: token });
  if (error) return { error: mensajeDeError(error) };

  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const id = await turnoIdDeToken(token);
    if (id) sincronizarGoogleDespues(id);
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
