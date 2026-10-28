"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sesionParaAccion } from "@/lib/auth";
import { crearSupabaseServidor } from "@/lib/supabase/server";
import { mensajeDeError } from "@/lib/errores";
import { localADate } from "@/lib/fechas";
import { datosDeForm, erroresDeCampo, esquemaBloqueo } from "@/lib/validaciones";
import type { EstadoAccion } from "@/lib/tipos";

export async function crearBloqueo(_prev: EstadoAccion, formData: FormData): Promise<EstadoAccion> {
  const sesion = await sesionParaAccion();
  if (!sesion) return { error: "No tenés permiso." };

  const datos = esquemaBloqueo.safeParse(datosDeForm(formData));
  if (!datos.success) return { errores: erroresDeCampo(datos.error) };
  const d = datos.data;

  // El empleado solo puede bloquear su propia agenda (RLS lo exige igual).
  if (!sesion.esDueno && d.profesional_id !== sesion.perfil.profesional_id) {
    return { error: "Solo podés cargar ausencias en tu propia agenda." };
  }

  const tz = sesion.negocio.zona_horaria;
  const [fDesde, hDesde] = d.desde.split("T");
  const [fHasta, hHasta] = d.hasta.split("T");

  const supabase = await crearSupabaseServidor();
  const { error } = await supabase.from("bloqueos").insert({
    negocio_id: sesion.negocio.id,
    profesional_id: d.profesional_id,
    inicio: localADate(fDesde, hDesde, tz).toISOString(),
    fin: localADate(fHasta, hHasta, tz).toISOString(),
    motivo: d.motivo,
  });
  if (error) return { error: mensajeDeError(error) };

  revalidatePath("/panel/bloqueos");
  return { ok: true, mensaje: "Ausencia guardada. Esos horarios ya no se ofrecen online." };
}

export async function eliminarBloqueo(id: string): Promise<EstadoAccion> {
  const sesion = await sesionParaAccion();
  if (!sesion) return { error: "No tenés permiso." };
  if (!z.uuid().safeParse(id).success) return { error: "Ausencia inválida." };

  const supabase = await crearSupabaseServidor();
  const { error } = await supabase.from("bloqueos").delete().eq("id", id).eq("negocio_id", sesion.negocio.id);
  if (error) return { error: mensajeDeError(error) };

  revalidatePath("/panel/bloqueos");
  return { ok: true };
}
