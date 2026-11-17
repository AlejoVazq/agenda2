"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { comoAnonimo, comoServidor, sql } from "@/lib/db";
import { notificarCancelacionCliente } from "@/lib/email/notificar";
import { sincronizarGoogleDespues } from "@/lib/google";
import { crearPagoSena } from "@/lib/mercadopago";
import { mensajeDeError } from "@/lib/errores";
import { dentroDelLimite } from "@/lib/limites";
import { datosDeForm, erroresDeCampo, esquemaResena, token as esquemaToken } from "@/lib/validaciones";
import type { EstadoAccion } from "@/lib/tipos";

/** Id del turno de un token (consulta fija: quien tiene el token ya ve el turno). */
async function turnoIdDeToken(token: string) {
  const fila = await comoServidor((tx) =>
    tx.uno<{ id: string }>(sql`select id from public.turnos where token_cancelacion = ${token}`),
  );
  return fila?.id ?? null;
}

export async function cancelarTurno(token: string, _prev: EstadoAccion): Promise<EstadoAccion> {
  if (!esquemaToken.safeParse(token).success) return { error: "No encontramos el turno." };

  try {
    // La función valida estado y política de cancelación del negocio.
    await comoAnonimo((tx) => tx.ejecutar(sql`select public.cancelar_turno_cliente(${token})`));
  } catch (e) {
    return { error: mensajeDeError(e) };
  }

  const id = await turnoIdDeToken(token);
  if (id) {
    sincronizarGoogleDespues(id);
    notificarCancelacionCliente(id);
  }

  revalidatePath(`/t/${token}`);
  return { ok: true, mensaje: "Tu turno fue cancelado." };
}

/** Reintentar el pago de la seña (si Mercado Pago falló o el cliente volvió sin pagar). */
export async function pagarSena(token: string, _prev: EstadoAccion): Promise<EstadoAccion> {
  if (!esquemaToken.safeParse(token).success) return { error: "No encontramos el turno." };
  const id = await turnoIdDeToken(token);
  if (!id) return { error: "No encontramos el turno." };

  const url = await crearPagoSena(id).catch(() => null);
  if (!url) {
    return { error: "No pudimos iniciar el pago. Puede que haya vencido el plazo: recargá la página o comunicate con el negocio." };
  }
  redirect(url);
}

/** Deja o cambia la opinión del turno (la base valida que el turno ya haya pasado). */
export async function opinar(token: string, _prev: EstadoAccion, formData: FormData): Promise<EstadoAccion> {
  const datos = esquemaResena.safeParse({ ...datosDeForm(formData), token });
  if (!datos.success) return { errores: erroresDeCampo(datos.error) };
  const d = datos.data;
  if (!(await dentroDelLimite("resena", 10, 3600))) {
    return { error: "Hiciste muchos intentos seguidos. Probá de nuevo en un rato." };
  }

  let slug: string | null = null;
  try {
    const fila = await comoServidor(async (tx) => {
      await tx.ejecutar(sql`select public.dejar_resena(${d.token}, ${d.estrellas}, ${d.comentario})`);
      return tx.uno<{ slug: string }>(sql`
        select n.slug from public.turnos t join public.negocios n on n.id = t.negocio_id
        where t.token_cancelacion = ${d.token}`);
    });
    slug = fila?.slug ?? null;
  } catch (e) {
    return { error: mensajeDeError(e) };
  }

  revalidatePath(`/t/${token}`);
  if (slug) {
    revalidatePath(`/n/${slug}`);
    revalidatePath(`/n/${slug}/opiniones`);
  }
  return { ok: true, mensaje: "¡Gracias por tu opinión!" };
}
