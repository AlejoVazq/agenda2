"use server";

import { revalidatePath } from "next/cache";
import { sesionParaAccion } from "@/lib/auth";
import { comoUsuario, esErrorPg, sql } from "@/lib/db";
import { mensajeDeError } from "@/lib/errores";
import { borrarLogo, guardarLogo, LOGO_MAX_BYTES, tipoDeImagen } from "@/lib/logo";
import { MENSAJE_SOLO_LECTURA } from "@/lib/suscripcion";
import { datosDeForm, erroresDeCampo, esquemaNegocio } from "@/lib/validaciones";
import type { EstadoAccion } from "@/lib/tipos";

export async function guardarNegocio(_prev: EstadoAccion, formData: FormData): Promise<EstadoAccion> {
  const sesion = await sesionParaAccion({ soloDueno: true });
  if (!sesion) return { error: "Solo el dueño puede modificar los datos del negocio." };

  const datos = esquemaNegocio.safeParse(datosDeForm(formData));
  if (!datos.success) return { errores: erroresDeCampo(datos.error) };

  const d = datos.data;
  try {
    await comoUsuario(sesion.userId, (tx) =>
      tx.ejecutar(sql`
        update public.negocios set
          nombre = ${d.nombre}, slug = ${d.slug}, rubro = ${d.rubro},
          telefono = ${d.telefono ?? null}, direccion = ${d.direccion ?? null}, descripcion = ${d.descripcion ?? null},
          cancelacion_min_horas = ${d.cancelacion_min_horas}, anticipacion_min_min = ${d.anticipacion_min_min},
          anticipacion_max_dias = ${d.anticipacion_max_dias}, intervalo_min = ${d.intervalo_min},
          confirmacion_automatica = ${d.confirmacion_automatica}, recordatorio_horas = ${d.recordatorio_horas}
        where id = ${sesion.negocio.id}`),
    );
  } catch (e) {
    if (esErrorPg(e) && e.code === "23505") return { errores: { slug: ["Esa dirección ya está en uso. Probá con otra."] } };
    return { error: mensajeDeError(e) };
  }

  revalidatePath("/panel", "layout");
  return { ok: true, mensaje: "Cambios guardados." };
}

// --- Logo ------------------------------------------------------------------------------

export async function subirLogo(formData: FormData): Promise<EstadoAccion> {
  const sesion = await sesionParaAccion({ soloDueno: true });
  if (!sesion) return { error: "Solo el dueño puede cambiar el logo." };
  if (!sesion.habilitado) return { error: MENSAJE_SOLO_LECTURA };

  const archivo = formData.get("logo");
  if (!(archivo instanceof File) || archivo.size === 0) return { error: "Elegí una imagen." };
  if (archivo.size > LOGO_MAX_BYTES) return { error: "La imagen es muy pesada (máximo 512 KB)." };
  const datos = Buffer.from(await archivo.arrayBuffer());
  const tipo = tipoDeImagen(datos);
  if (!tipo) return { error: "Formato no admitido: usá PNG, JPG o WebP." };

  try {
    await guardarLogo(sesion.negocio.id, tipo, datos);
  } catch (e) {
    return { error: mensajeDeError(e) };
  }
  revalidatePath("/panel", "layout");
  revalidatePath(`/n/${sesion.negocio.slug}`, "layout");
  return { ok: true, mensaje: "Logo actualizado." };
}

export async function quitarLogo(): Promise<EstadoAccion> {
  const sesion = await sesionParaAccion({ soloDueno: true });
  if (!sesion) return { error: "Solo el dueño puede cambiar el logo." };
  if (!sesion.habilitado) return { error: MENSAJE_SOLO_LECTURA };
  try {
    await borrarLogo(sesion.negocio.id);
  } catch (e) {
    return { error: mensajeDeError(e) };
  }
  revalidatePath("/panel", "layout");
  revalidatePath(`/n/${sesion.negocio.slug}`, "layout");
  return { ok: true, mensaje: "Logo quitado." };
}
