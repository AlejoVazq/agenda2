"use server";

import { redirect } from "next/navigation";
import { comoUsuario, sql } from "@/lib/db";
import { esAdministrador, getSesion, getSesionPanel } from "@/lib/auth";
import { mensajeDeError } from "@/lib/errores";
import { datosDeForm, erroresDeCampo, esquemaOnboarding } from "@/lib/validaciones";
import type { EstadoAccion } from "@/lib/tipos";

export async function crearNegocio(_prev: EstadoAccion, formData: FormData): Promise<EstadoAccion> {
  const sesion = await getSesion();
  if (!sesion) redirect("/login");
  if (await getSesionPanel()) redirect("/panel");
  // Las cuentas de administrador no tienen negocio.
  if (await esAdministrador(sesion.userId)) redirect("/admin");

  const datos = esquemaOnboarding.safeParse(datosDeForm(formData));
  if (!datos.success) return { errores: erroresDeCampo(datos.error) };
  const d = datos.data;

  try {
    await comoUsuario(sesion.userId, (tx) =>
      tx.uno(sql`
        select public.crear_negocio(
          ${d.nombre}, ${d.slug}, ${d.rubro}, ${d.nombre_dueno}, ${d.telefono ?? null}, ${d.direccion ?? null}, ${d.dueno_atiende}
        )`),
    );
  } catch (e) {
    if (e instanceof Error && e.message.includes("SLUG_OCUPADO")) {
      return { errores: { slug: ["Esa dirección ya está en uso. Probá con otra."] } };
    }
    return { error: mensajeDeError(e) };
  }

  redirect("/panel?bienvenida=1");
}
