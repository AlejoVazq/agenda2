"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { sesionParaAccion } from "@/lib/auth";
import { crearSupabaseServidor } from "@/lib/supabase/server";
import { mensajeDeError } from "@/lib/errores";
import { datosDeForm, erroresDeCampo, esquemaServicio } from "@/lib/validaciones";
import type { EstadoAccion } from "@/lib/tipos";

const SIN_PERMISO: EstadoAccion = { error: "Solo el dueño del negocio puede modificar los servicios." };

export async function guardarServicio(
  id: string | null,
  _prev: EstadoAccion,
  formData: FormData,
): Promise<EstadoAccion> {
  const sesion = await sesionParaAccion({ soloDueno: true });
  if (!sesion) return SIN_PERMISO;
  if (id && !z.uuid().safeParse(id).success) return { error: "Servicio inválido." };

  const datos = esquemaServicio.safeParse(datosDeForm(formData));
  if (!datos.success) return { errores: erroresDeCampo(datos.error) };

  const supabase = await crearSupabaseServidor();
  if (id) {
    const { error } = await supabase.from("servicios").update(datos.data).eq("id", id).eq("negocio_id", sesion.negocio.id);
    if (error) return { error: mensajeDeError(error) };
  } else {
    const { data: nuevo, error } = await supabase
      .from("servicios")
      .insert({ ...datos.data, negocio_id: sesion.negocio.id })
      .select("id")
      .single();
    if (error) return { error: mensajeDeError(error) };

    // Con un solo profesional no hay nada que elegir: si no, el servicio no se podría reservar.
    const { data: profesionales } = await supabase.from("profesionales").select("id").eq("activo", true).limit(2);
    if (profesionales?.length === 1) {
      await supabase
        .from("profesional_servicio")
        .insert({ negocio_id: sesion.negocio.id, profesional_id: profesionales[0].id, servicio_id: nuevo.id });
    }
  }

  revalidatePath("/panel/servicios");
  redirect("/panel/servicios");
}

export async function eliminarServicio(id: string): Promise<EstadoAccion> {
  const sesion = await sesionParaAccion({ soloDueno: true });
  if (!sesion) return SIN_PERMISO;
  if (!z.uuid().safeParse(id).success) return { error: "Servicio inválido." };

  const supabase = await crearSupabaseServidor();
  const { error } = await supabase.from("servicios").delete().eq("id", id).eq("negocio_id", sesion.negocio.id);
  if (error) {
    if (error.code === "23503") {
      return { error: "Este servicio tiene turnos registrados. En lugar de borrarlo, desactivalo." };
    }
    return { error: mensajeDeError(error) };
  }

  revalidatePath("/panel/servicios");
  redirect("/panel/servicios");
}
