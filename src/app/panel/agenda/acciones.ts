"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sesionParaAccion } from "@/lib/auth";
import { crearSupabaseAdmin } from "@/lib/supabase/admin";
import { crearSupabaseServidor } from "@/lib/supabase/server";
import { mensajeDeError } from "@/lib/errores";
import { localADate } from "@/lib/fechas";
import { turnosEnRango, type TurnoConDetalle } from "@/lib/datos-panel";
import { notificarCambioTurno } from "@/lib/email/notificar";
import { sincronizarGoogleDespues } from "@/lib/google";
import {
  datosDeForm,
  erroresDeCampo,
  esquemaEstadoTurno,
  esquemaMoverTurno,
  esquemaTurnoPanel,
} from "@/lib/validaciones";
import type { EstadoAccion } from "@/lib/tipos";

export type EventoAgenda = {
  id: string;
  tipo: "turno" | "bloqueo";
  inicio: string;
  fin: string;
  profesional_id: string;
  titulo: string;
  color: string;
  turno?: TurnoConDetalle;
};

const esquemaRango = z.object({
  desde: z.iso.datetime({ offset: true }),
  hasta: z.iso.datetime({ offset: true }),
  profesional_id: z.uuid().nullable(),
});

/** Turnos y ausencias de un rango, para el calendario. RLS limita por rol. */
export async function eventosAgenda(entrada: z.input<typeof esquemaRango>): Promise<EventoAgenda[]> {
  const sesion = await sesionParaAccion();
  if (!sesion) return [];
  const datos = esquemaRango.safeParse(entrada);
  if (!datos.success) return [];
  const { desde, hasta, profesional_id } = datos.data;

  // Máximo ~6 semanas por consulta.
  if (new Date(hasta).getTime() - new Date(desde).getTime() > 45 * 86_400_000) return [];

  const supabase = await crearSupabaseServidor();
  let consultaBloqueos = supabase
    .from("bloqueos")
    .select("id, profesional_id, inicio, fin, motivo")
    .lt("inicio", hasta)
    .gt("fin", desde);
  if (profesional_id) consultaBloqueos = consultaBloqueos.eq("profesional_id", profesional_id);

  const [turnos, { data: bloqueos }] = await Promise.all([
    turnosEnRango(new Date(desde), new Date(hasta), { profesionalId: profesional_id ?? undefined }),
    consultaBloqueos,
  ]);

  return [
    ...turnos.map<EventoAgenda>((t) => ({
      id: t.id,
      tipo: "turno",
      inicio: t.inicio,
      fin: t.fin,
      profesional_id: t.profesional_id,
      titulo: `${t.cliente?.nombre ?? "Cliente"} · ${t.servicio?.nombre ?? ""}`,
      color: t.profesional?.color ?? "#7434ee",
      turno: t,
    })),
    ...(bloqueos ?? []).map<EventoAgenda>((b) => ({
      id: `b-${b.id}`,
      tipo: "bloqueo",
      inicio: b.inicio,
      fin: b.fin,
      profesional_id: b.profesional_id,
      titulo: b.motivo ?? "Ausencia",
      color: "#a1a1aa",
    })),
  ];
}

/**
 * Libera retenciones de seña vencidas antes de ocupar un horario desde el panel,
 * para que no choquen con un turno que en realidad ya no existe.
 */
async function liberarSenasVencidas(negocioId: string) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  await crearSupabaseAdmin()
    .rpc("vencer_pagos_pendientes", { p_negocio_id: negocioId })
    .then(
      () => null,
      () => null,
    );
}

/** Mover o cambiar la duración de un turno (arrastrar en el calendario). */
export async function moverTurno(entrada: z.input<typeof esquemaMoverTurno>): Promise<EstadoAccion> {
  const sesion = await sesionParaAccion();
  if (!sesion) return { error: "No tenés permiso." };
  const datos = esquemaMoverTurno.safeParse(entrada);
  if (!datos.success) return { error: "Datos inválidos." };
  const { id, inicio, fin, profesional_id } = datos.data;
  if (new Date(fin) <= new Date(inicio)) return { error: "El horario no es válido." };

  const cambios: Record<string, string> = { inicio, fin };
  if (profesional_id) {
    if (!sesion.esDueno) return { error: "Solo el dueño puede pasar un turno a otro profesional." };
    cambios.profesional_id = profesional_id;
  }

  await liberarSenasVencidas(sesion.negocio.id);
  const supabase = await crearSupabaseServidor();
  // RLS: el empleado solo puede modificar turnos de su agenda.
  const { data, error } = await supabase
    .from("turnos")
    .update(cambios)
    .eq("id", id)
    .in("estado", ["pendiente", "confirmado"])
    .select("id");
  if (error) return { error: mensajeDeError(error) };
  if (!data?.length) return { error: "No se pudo mover el turno." };

  await notificarCambioTurno(id, "reprogramado");
  sincronizarGoogleDespues(id);
  revalidatePath("/panel");
  return { ok: true, mensaje: "Turno movido." };
}

export async function cambiarEstadoTurno(entrada: z.input<typeof esquemaEstadoTurno>): Promise<EstadoAccion> {
  const sesion = await sesionParaAccion();
  if (!sesion) return { error: "No tenés permiso." };
  const datos = esquemaEstadoTurno.safeParse(entrada);
  if (!datos.success) return { error: "Datos inválidos." };
  const { id, estado } = datos.data;

  const supabase = await crearSupabaseServidor();
  const { data: actual } = await supabase.from("turnos").select("pago_estado").eq("id", id).maybeSingle();

  const cambios: Record<string, string | null> =
    estado === "cancelado"
      ? { estado, cancelado_at: new Date().toISOString(), cancelado_por: "negocio" }
      : { estado, cancelado_at: null, cancelado_por: null };
  // Confirmar o reactivar a mano un turno que esperaba la seña: el negocio
  // decide tomarlo igual, así que deja de vencer.
  if (estado !== "cancelado" && (actual?.pago_estado === "pendiente" || actual?.pago_estado === "vencido")) {
    cambios.pago_estado = null;
  }

  const { data, error } = await supabase.from("turnos").update(cambios).eq("id", id).select("id");
  if (error) {
    // Reactivar un turno cancelado puede chocar con otro que tomó ese horario.
    return { error: mensajeDeError(error) };
  }
  if (!data?.length) return { error: "No se encontró el turno." };

  if (estado === "cancelado") await notificarCambioTurno(id, "cancelado");
  sincronizarGoogleDespues(id);
  revalidatePath("/panel", "layout");
  return { ok: true, mensaje: "Turno actualizado." };
}

export async function crearTurnoPanel(_prev: EstadoAccion, formData: FormData): Promise<EstadoAccion> {
  const sesion = await sesionParaAccion();
  if (!sesion) return { error: "No tenés permiso." };

  const datos = esquemaTurnoPanel.safeParse(datosDeForm(formData));
  if (!datos.success) return { errores: erroresDeCampo(datos.error) };
  const d = datos.data;

  if (!sesion.esDueno && d.profesional_id !== sesion.perfil.profesional_id) {
    return { error: "Solo podés agendar turnos en tu propia agenda." };
  }

  await liberarSenasVencidas(sesion.negocio.id);
  const supabase = await crearSupabaseServidor();
  const { data: nuevoId, error } = await supabase.rpc("crear_turno_panel", {
    p_profesional_id: d.profesional_id,
    p_servicio_id: d.servicio_id,
    p_inicio: localADate(d.fecha, d.hora, sesion.negocio.zona_horaria).toISOString(),
    p_cliente_nombre: d.cliente_nombre,
    p_cliente_telefono: d.cliente_telefono,
    p_cliente_email: d.cliente_email,
    p_notas: d.notas,
  });
  if (error) return { error: mensajeDeError(error) };

  if (typeof nuevoId === "string") sincronizarGoogleDespues(nuevoId);
  revalidatePath("/panel", "layout");
  return { ok: true, mensaje: "Turno agendado." };
}
