"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sesionParaAccion } from "@/lib/auth";
import { crearSupabaseServidor } from "@/lib/supabase/server";
import { mensajeDeError } from "@/lib/errores";
import { datosDeForm, erroresDeCampo, esquemaCliente } from "@/lib/validaciones";
import type { EstadoAccion } from "@/lib/tipos";

export async function guardarCliente(id: string, _prev: EstadoAccion, formData: FormData): Promise<EstadoAccion> {
  const sesion = await sesionParaAccion({ soloDueno: true });
  if (!sesion) return { error: "Solo el dueño puede editar clientes." };
  if (!z.uuid().safeParse(id).success) return { error: "Cliente inválido." };

  const datos = esquemaCliente.safeParse(datosDeForm(formData));
  if (!datos.success) return { errores: erroresDeCampo(datos.error) };

  const supabase = await crearSupabaseServidor();
  const { data, error } = await supabase.from("clientes").update(datos.data).eq("id", id).select("id");
  if (error) {
    if (error.code === "23505") return { errores: { telefono: ["Ya hay otro cliente con ese celular."] } };
    return { error: mensajeDeError(error) };
  }
  if (!data?.length) return { error: "No se encontró el cliente." };

  revalidatePath(`/panel/clientes/${id}`);
  return { ok: true, mensaje: "Cliente actualizado." };
}

/** Las inasistencias que tuvo hasta ahora dejan de limitar sus reservas online. */
export async function quitarLimiteCliente(id: string): Promise<EstadoAccion> {
  const sesion = await sesionParaAccion({ soloDueno: true });
  if (!sesion) return { error: "Solo el dueño puede quitar el límite." };
  if (!z.uuid().safeParse(id).success) return { error: "Cliente inválido." };

  const supabase = await crearSupabaseServidor();
  const { data, error } = await supabase
    .from("clientes")
    .update({ ausencias_perdonadas_at: new Date().toISOString() })
    .eq("id", id)
    .select("id");
  if (error) return { error: mensajeDeError(error) };
  if (!data?.length) return { error: "No se encontró el cliente." };

  revalidatePath(`/panel/clientes/${id}`);
  return { ok: true, mensaje: "Límite quitado." };
}
