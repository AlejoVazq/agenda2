"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sesionParaAccion } from "@/lib/auth";
import { comoUsuario, sql } from "@/lib/db";
import { mensajeDeError } from "@/lib/errores";
import { MENSAJE_SOLO_LECTURA } from "@/lib/suscripcion";
import { datosDeForm, erroresDeCampo, esquemaRespuestaResena } from "@/lib/validaciones";
import type { EstadoAccion } from "@/lib/tipos";

// Opiniones de los clientes: el dueño responde, oculta un comentario, borra una
// opinión basura o las apaga. RLS limita a su negocio y los grants de update a
// respuesta y comentario_oculto (nunca las estrellas); borrar se puede (0018).

async function sesionDueno() {
  const sesion = await sesionParaAccion({ soloDueno: true });
  if (!sesion) return { error: "Solo el dueño puede gestionar las opiniones." } as const;
  if (!sesion.habilitado) return { error: MENSAJE_SOLO_LECTURA } as const;
  return { sesion } as const;
}

function revalidar(slug: string) {
  revalidatePath("/panel/opiniones");
  revalidatePath(`/n/${slug}`, "layout");
}

export async function responderResena(_prev: EstadoAccion, formData: FormData): Promise<EstadoAccion> {
  const datos = esquemaRespuestaResena.safeParse(datosDeForm(formData));
  if (!datos.success) return { errores: erroresDeCampo(datos.error) };
  const s = await sesionDueno();
  if ("error" in s) return { error: s.error };
  const { id, respuesta } = datos.data;
  try {
    const fila = await comoUsuario(s.sesion.userId, (tx) =>
      tx.uno<{ id: string }>(sql`
        update public.resenas
        set respuesta = ${respuesta}, respondida_at = case when ${respuesta}::text is null then null else now() end
        where id = ${id}
        returning id`),
    );
    if (!fila) return { error: "No encontramos esa opinión." };
  } catch (e) {
    return { error: mensajeDeError(e) };
  }
  revalidar(s.sesion.negocio.slug);
  return { ok: true, mensaje: respuesta ? "Respuesta publicada." : "Respuesta borrada." };
}

export async function ocultarComentario(id: string, ocultar: boolean): Promise<EstadoAccion> {
  if (!z.uuid().safeParse(id).success) return { error: "No encontramos esa opinión." };
  const s = await sesionDueno();
  if ("error" in s) return { error: s.error };
  try {
    const fila = await comoUsuario(s.sesion.userId, (tx) =>
      tx.uno<{ id: string }>(sql`update public.resenas set comentario_oculto = ${ocultar} where id = ${id} returning id`),
    );
    if (!fila) return { error: "No encontramos esa opinión." };
  } catch (e) {
    return { error: mensajeDeError(e) };
  }
  revalidar(s.sesion.negocio.slug);
  return { ok: true, mensaje: ocultar ? "Comentario oculto. El puntaje sigue contando." : "Comentario visible otra vez." };
}

export async function eliminarResena(id: string): Promise<EstadoAccion> {
  if (!z.uuid().safeParse(id).success) return { error: "No encontramos esa opinión." };
  const s = await sesionDueno();
  if ("error" in s) return { error: s.error };
  try {
    const fila = await comoUsuario(s.sesion.userId, (tx) =>
      tx.uno<{ id: string }>(sql`delete from public.resenas where id = ${id} returning id`),
    );
    if (!fila) return { error: "No encontramos esa opinión." };
  } catch (e) {
    return { error: mensajeDeError(e) };
  }
  revalidar(s.sesion.negocio.slug);
  return { ok: true, mensaje: "Opinión eliminada." };
}

export async function activarResenas(activas: boolean): Promise<EstadoAccion> {
  const s = await sesionDueno();
  if ("error" in s) return { error: s.error };
  try {
    await comoUsuario(s.sesion.userId, (tx) =>
      tx.ejecutar(sql`update public.negocios set resenas_activas = ${activas === true} where id = ${s.sesion.negocio.id}`),
    );
  } catch (e) {
    return { error: mensajeDeError(e) };
  }
  revalidar(s.sesion.negocio.slug);
  return {
    ok: true,
    mensaje: activas ? "Las opiniones se muestran en tu página." : "Las opiniones quedaron ocultas y no se piden nuevas.",
  };
}
