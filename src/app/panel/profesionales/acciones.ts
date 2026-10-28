"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { sesionParaAccion } from "@/lib/auth";
import { crearSupabaseServidor } from "@/lib/supabase/server";
import { mensajeDeError } from "@/lib/errores";
import { datosDeForm, erroresDeCampo, esquemaFranjas, esquemaProfesional } from "@/lib/validaciones";
import type { EstadoAccion } from "@/lib/tipos";

const SIN_PERMISO: EstadoAccion = { error: "Solo el dueño del negocio puede modificar el equipo." };
const idValido = (id: string) => z.uuid().safeParse(id).success;

export async function guardarProfesional(
  id: string | null,
  _prev: EstadoAccion,
  formData: FormData,
): Promise<EstadoAccion> {
  const sesion = await sesionParaAccion({ soloDueno: true });
  if (!sesion) return SIN_PERMISO;
  if (id && !idValido(id)) return { error: "Profesional inválido." };

  const datos = esquemaProfesional.safeParse(datosDeForm(formData));
  if (!datos.success) return { errores: erroresDeCampo(datos.error) };

  const supabase = await crearSupabaseServidor();
  if (id) {
    const { error } = await supabase
      .from("profesionales")
      .update(datos.data)
      .eq("id", id)
      .eq("negocio_id", sesion.negocio.id);
    if (error) return { error: mensajeDeError(error) };
    revalidatePath(`/panel/profesionales/${id}`);
    return { ok: true, mensaje: "Datos guardados." };
  }

  const { data, error } = await supabase
    .from("profesionales")
    .insert({ ...datos.data, negocio_id: sesion.negocio.id })
    .select("id")
    .single();
  if (error) return { error: mensajeDeError(error) };

  revalidatePath("/panel/profesionales");
  redirect(`/panel/profesionales/${data.id}?nuevo=1`);
}

export async function guardarServiciosProfesional(
  id: string,
  _prev: EstadoAccion,
  formData: FormData,
): Promise<EstadoAccion> {
  const sesion = await sesionParaAccion({ soloDueno: true });
  if (!sesion) return SIN_PERMISO;
  if (!idValido(id)) return { error: "Profesional inválido." };

  const ids = z.array(z.uuid()).max(200).safeParse(formData.getAll("servicio_id"));
  if (!ids.success) return { error: "Selección inválida." };

  const supabase = await crearSupabaseServidor();
  const { error } = await supabase.rpc("guardar_servicios_profesional", {
    p_profesional_id: id,
    p_servicio_ids: ids.data,
  });
  if (error) return { error: mensajeDeError(error) };

  revalidatePath(`/panel/profesionales/${id}`);
  return { ok: true, mensaje: "Servicios actualizados." };
}

export async function guardarHorarios(id: string, _prev: EstadoAccion, formData: FormData): Promise<EstadoAccion> {
  const sesion = await sesionParaAccion({ soloDueno: true });
  if (!sesion) return SIN_PERMISO;
  if (!idValido(id)) return { error: "Profesional inválido." };

  let crudo: unknown;
  try {
    crudo = JSON.parse(String(formData.get("franjas") ?? "[]"));
  } catch {
    return { error: "Formato de horarios inválido." };
  }
  const franjas = esquemaFranjas.safeParse(crudo);
  if (!franjas.success) return { error: franjas.error.issues[0]?.message ?? "Horarios inválidos." };

  const supabase = await crearSupabaseServidor();
  const { error } = await supabase.rpc("guardar_horarios", { p_profesional_id: id, p_franjas: franjas.data });
  if (error) return { error: mensajeDeError(error) };

  revalidatePath(`/panel/profesionales/${id}`);
  return { ok: true, mensaje: "Horarios guardados." };
}

export async function eliminarProfesional(id: string): Promise<EstadoAccion> {
  const sesion = await sesionParaAccion({ soloDueno: true });
  if (!sesion) return SIN_PERMISO;
  if (!idValido(id)) return { error: "Profesional inválido." };

  const supabase = await crearSupabaseServidor();
  const { error } = await supabase.from("profesionales").delete().eq("id", id).eq("negocio_id", sesion.negocio.id);
  if (error) {
    if (error.code === "23503") {
      return { error: "Este profesional tiene turnos registrados. En lugar de borrarlo, desactivalo." };
    }
    return { error: mensajeDeError(error) };
  }

  revalidatePath("/panel/profesionales");
  redirect("/panel/profesionales");
}
