"use server";

import { revalidatePath } from "next/cache";
import { sesionParaAccion } from "@/lib/auth";
import { crearSupabaseServidor } from "@/lib/supabase/server";
import { mensajeDeError } from "@/lib/errores";
import { datosDeForm, erroresDeCampo, esquemaNegocio } from "@/lib/validaciones";
import type { EstadoAccion } from "@/lib/tipos";

export async function guardarNegocio(_prev: EstadoAccion, formData: FormData): Promise<EstadoAccion> {
  const sesion = await sesionParaAccion({ soloDueno: true });
  if (!sesion) return { error: "Solo el dueño puede modificar los datos del negocio." };

  const datos = esquemaNegocio.safeParse(datosDeForm(formData));
  if (!datos.success) return { errores: erroresDeCampo(datos.error) };

  const supabase = await crearSupabaseServidor();
  const { error } = await supabase.from("negocios").update(datos.data).eq("id", sesion.negocio.id);
  if (error) {
    if (error.code === "23505") return { errores: { slug: ["Esa dirección ya está en uso. Probá con otra."] } };
    return { error: mensajeDeError(error) };
  }

  revalidatePath("/panel", "layout");
  return { ok: true, mensaje: "Cambios guardados." };
}
