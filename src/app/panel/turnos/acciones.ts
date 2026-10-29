"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sesionParaAccion } from "@/lib/auth";
import { crearSupabaseServidor } from "@/lib/supabase/server";
import { mensajeDeError } from "@/lib/errores";
import { localADate } from "@/lib/fechas";
import { notificarCambioTurno } from "@/lib/email/notificar";
import { sincronizarGoogleDespues } from "@/lib/google";
import { datosDeForm, erroresDeCampo } from "@/lib/validaciones";
import type { EstadoAccion } from "@/lib/tipos";

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

  const supabase = await crearSupabaseServidor();
  const { data: turno } = await supabase.from("turnos").select("inicio, fin, estado").eq("id", id).maybeSingle();
  if (!turno) return { error: "No se encontró el turno." };
  if (turno.estado !== "pendiente" && turno.estado !== "confirmado") {
    return { error: "Solo se pueden reprogramar turnos pendientes o confirmados." };
  }

  const duracion = new Date(turno.fin).getTime() - new Date(turno.inicio).getTime();
  const inicio = localADate(datos.data.fecha, datos.data.hora, sesion.negocio.zona_horaria);
  const fin = new Date(inicio.getTime() + duracion);

  const { data: actualizados, error } = await supabase
    .from("turnos")
    .update({ inicio: inicio.toISOString(), fin: fin.toISOString() })
    .eq("id", id)
    .select("id");
  if (error) return { error: mensajeDeError(error) };
  if (!actualizados?.length) return { error: "No tenés permiso para modificar este turno." };

  await notificarCambioTurno(id, "reprogramado");
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

  const supabase = await crearSupabaseServidor();
  const { error } = await supabase.from("turnos").update({ notas: notas.data || null }).eq("id", id);
  if (error) return { error: mensajeDeError(error) };
  sincronizarGoogleDespues(id);

  revalidatePath(`/panel/turnos/${id}`);
  return { ok: true, mensaje: "Notas guardadas." };
}

/** La seña se cobró por fuera de Mercado Pago (efectivo, transferencia). */
export async function marcarSenaPagada(id: string): Promise<EstadoAccion> {
  const sesion = await sesionParaAccion();
  if (!sesion) return { error: "No tenés permiso." };
  if (!z.uuid().safeParse(id).success) return { error: "Turno inválido." };

  const supabase = await crearSupabaseServidor();
  const { data, error } = await supabase
    .from("turnos")
    .update({ pago_estado: "aprobado", ...(sesion.negocio.confirmacion_automatica ? { estado: "confirmado" } : {}) })
    .eq("id", id)
    .eq("pago_estado", "pendiente")
    .in("estado", ["pendiente", "confirmado"])
    .select("id");
  if (error) return { error: mensajeDeError(error) };
  if (!data?.length) return { error: "La seña ya no estaba pendiente." };

  sincronizarGoogleDespues(id);
  revalidatePath(`/panel/turnos/${id}`);
  return { ok: true, mensaje: "Seña marcada como pagada." };
}

/** La seña a devolver ya se devolvió (o se acordó otra cosa con el cliente). */
export async function marcarSenaDevuelta(id: string): Promise<EstadoAccion> {
  const sesion = await sesionParaAccion();
  if (!sesion) return { error: "No tenés permiso." };
  if (!z.uuid().safeParse(id).success) return { error: "Turno inválido." };

  const supabase = await crearSupabaseServidor();
  const { data, error } = await supabase
    .from("turnos")
    .update({ pago_estado: "devuelta" })
    .eq("id", id)
    .eq("pago_estado", "reembolsar")
    .select("id");
  if (error) return { error: mensajeDeError(error) };
  if (!data?.length) return { error: "No había una seña para devolver." };

  revalidatePath(`/panel/turnos/${id}`);
  revalidatePath("/panel");
  return { ok: true, mensaje: "Listo, quedó registrada la devolución." };
}
