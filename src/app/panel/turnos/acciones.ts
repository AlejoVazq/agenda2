"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sesionParaAccion } from "@/lib/auth";
import { comoUsuario, sql } from "@/lib/db";
import { mensajeDeError } from "@/lib/errores";
import { localADate } from "@/lib/fechas";
import { notificarCambioTurno } from "@/lib/email/notificar";
import { sincronizarGoogleDespues } from "@/lib/google";
import { datosDeForm, erroresDeCampo } from "@/lib/validaciones";
import type { EstadoAccion, EstadoTurno } from "@/lib/tipos";

const esquemaReprogramar = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
  hora: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida"),
});

/** Cambia día y hora de un turno manteniendo su duración. */
export async function reprogramarTurno(id: string, _prev: EstadoAccion, formData: FormData): Promise<EstadoAccion> {
  const sesion = await sesionParaAccion();
  if (!sesion) return { error: "No tenés permiso." };
  if (!z.uuid().safeParse(id).success) return { error: "Turno inválido." };

  const datos = esquemaReprogramar.safeParse(datosDeForm(formData));
  if (!datos.success) return { errores: erroresDeCampo(datos.error) };
  const inicio = localADate(datos.data.fecha, datos.data.hora, sesion.negocio.zona_horaria);

  try {
    // RLS: un empleado solo modifica turnos de su agenda.
    const r = await comoUsuario(sesion.userId, async (tx) => {
      const turno = await tx.uno<{ estado: EstadoTurno }>(sql`select estado from public.turnos where id = ${id} for update`);
      if (!turno) return "No se encontró el turno.";
      if (turno.estado !== "pendiente" && turno.estado !== "confirmado") {
        return "Solo se pueden reprogramar turnos pendientes o confirmados.";
      }
      // La duración se mantiene: fin = inicio nuevo + (fin - inicio).
      const n = await tx.ejecutar(sql`
        update public.turnos
        set inicio = ${inicio.toISOString()}::timestamptz,
            fin = ${inicio.toISOString()}::timestamptz + (fin - inicio)
        where id = ${id}`);
      return n ? null : "No tenés permiso para modificar este turno.";
    });
    if (r) return { error: r };
  } catch (e) {
    return { error: mensajeDeError(e) };
  }

  notificarCambioTurno(id, "reprogramado");
  sincronizarGoogleDespues(id);
  revalidatePath(`/panel/turnos/${id}`);
  return { ok: true, mensaje: "Turno reprogramado." };
}

export async function guardarNotas(id: string, _prev: EstadoAccion, formData: FormData): Promise<EstadoAccion> {
  const sesion = await sesionParaAccion();
  if (!sesion) return { error: "No tenés permiso." };
  if (!z.uuid().safeParse(id).success) return { error: "Turno inválido." };

  const notas = z.string().trim().max(500, "Máximo 500 caracteres").safeParse(String(formData.get("notas") ?? ""));
  if (!notas.success) return { errores: { notas: [notas.error.issues[0].message] } };

  try {
    await comoUsuario(sesion.userId, (tx) =>
      tx.ejecutar(sql`update public.turnos set notas = ${notas.data || null} where id = ${id}`),
    );
  } catch (e) {
    return { error: mensajeDeError(e) };
  }
  sincronizarGoogleDespues(id);

  revalidatePath(`/panel/turnos/${id}`);
  return { ok: true, mensaje: "Notas guardadas." };
}

/** La seña se cobró por fuera de Mercado Pago (efectivo, transferencia). */
export async function marcarSenaPagada(id: string): Promise<EstadoAccion> {
  const sesion = await sesionParaAccion();
  if (!sesion) return { error: "No tenés permiso." };
  if (!z.uuid().safeParse(id).success) return { error: "Turno inválido." };

  let n: number;
  try {
    n = await comoUsuario(sesion.userId, (tx) =>
      tx.ejecutar(sql`
        update public.turnos
        set pago_estado = 'aprobado'
            ${sesion.negocio.confirmacion_automatica ? sql`, estado = 'confirmado'` : sql``}
        where id = ${id} and pago_estado = 'pendiente' and estado in ('pendiente', 'confirmado')`),
    );
  } catch (e) {
    return { error: mensajeDeError(e) };
  }
  if (!n) return { error: "La seña ya no estaba pendiente." };

  sincronizarGoogleDespues(id);
  revalidatePath(`/panel/turnos/${id}`);
  return { ok: true, mensaje: "Seña marcada como pagada." };
}

/** La seña a devolver ya se devolvió (o se acordó otra cosa con el cliente). */
export async function marcarSenaDevuelta(id: string): Promise<EstadoAccion> {
  const sesion = await sesionParaAccion();
  if (!sesion) return { error: "No tenés permiso." };
  if (!z.uuid().safeParse(id).success) return { error: "Turno inválido." };

  let n: number;
  try {
    n = await comoUsuario(sesion.userId, (tx) =>
      tx.ejecutar(sql`update public.turnos set pago_estado = 'devuelta' where id = ${id} and pago_estado = 'reembolsar'`),
    );
  } catch (e) {
    return { error: mensajeDeError(e) };
  }
  if (!n) return { error: "No había una seña para devolver." };

  revalidatePath(`/panel/turnos/${id}`);
  revalidatePath("/panel");
  return { ok: true, mensaje: "Listo, quedó registrada la devolución." };
}
