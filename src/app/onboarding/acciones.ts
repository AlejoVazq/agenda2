"use server";

import { redirect } from "next/navigation";
import { crearSupabaseServidor } from "@/lib/supabase/server";
import { getSesion, getSesionPanel } from "@/lib/auth";
import { mensajeDeError } from "@/lib/errores";
import { datosDeForm, erroresDeCampo, esquemaOnboarding } from "@/lib/validaciones";
import type { EstadoAccion } from "@/lib/tipos";

export async function crearNegocio(_prev: EstadoAccion, formData: FormData): Promise<EstadoAccion> {
  if (!(await getSesion())) redirect("/login");
  if (await getSesionPanel()) redirect("/panel");

  const datos = esquemaOnboarding.safeParse(datosDeForm(formData));
  if (!datos.success) return { errores: erroresDeCampo(datos.error) };
  const d = datos.data;

  const supabase = await crearSupabaseServidor();
  const { error } = await supabase.rpc("crear_negocio", {
    p_nombre: d.nombre,
    p_slug: d.slug,
    p_rubro: d.rubro,
    p_nombre_dueno: d.nombre_dueno,
    p_telefono: d.telefono,
    p_direccion: d.direccion,
    p_dueno_atiende: d.dueno_atiende,
  });

  if (error) {
    if (error.message.includes("SLUG_OCUPADO")) {
      return { errores: { slug: ["Esa dirección ya está en uso. Probá con otra."] } };
    }
    return { error: mensajeDeError(error) };
  }

  redirect("/panel?bienvenida=1");
}
