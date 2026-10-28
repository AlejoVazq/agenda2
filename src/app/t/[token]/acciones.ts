"use server";

import { revalidatePath } from "next/cache";
import { crearSupabaseServidor } from "@/lib/supabase/server";
import { mensajeDeError } from "@/lib/errores";
import { token as esquemaToken } from "@/lib/validaciones";
import type { EstadoAccion } from "@/lib/tipos";

export async function cancelarTurno(token: string, _prev: EstadoAccion): Promise<EstadoAccion> {
  if (!esquemaToken.safeParse(token).success) return { error: "No encontramos el turno." };

  const supabase = await crearSupabaseServidor();
  // La función valida estado y política de cancelación del negocio.
  const { error } = await supabase.rpc("cancelar_turno_cliente", { p_token: token });
  if (error) return { error: mensajeDeError(error) };

  revalidatePath(`/t/${token}`);
  return { ok: true, mensaje: "Tu turno fue cancelado." };
}
