"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sesionParaAccion } from "@/lib/auth";
import { comoServidor, comoUsuario, sql } from "@/lib/db";
import { mensajeDeError } from "@/lib/errores";
import { localADate } from "@/lib/fechas";
import { notificarCambioTurno } from "@/lib/email/notificar";
import { sincronizarGoogleDespues } from "@/lib/google";
import {
  datosDeForm,
  erroresDeCampo,
  esquemaEstadoTurno,
  esquemaMoverTurno,
  esquemaTurnoPanel,
} from "@/lib/validaciones";
import type { EstadoAccion, EstadoPago, EstadoTurno } from "@/lib/tipos";

/**
 * Libera retenciones de seña vencidas antes de ocupar un horario desde el panel,
 * para que no choquen con un turno que en realidad ya no existe. El negocio sale
 * de la sesión ya verificada.
 */
async function liberarSenasVencidas(negocioId: string) {
  await comoServidor((tx) => tx.ejecutar(sql`select public.vencer_pagos_pendientes(${negocioId})`)).catch(() => null);
}

/** Mover o cambiar la duración de un turno (arrastrar en el calendario). */
export async function moverTurno(entrada: z.input<typeof esquemaMoverTurno>): Promise<EstadoAccion> {
  const sesion = await sesionParaAccion();
  if (!sesion) return { error: "No tenés permiso." };
  const datos = esquemaMoverTurno.safeParse(entrada);
  if (!datos.success) return { error: "Datos inválidos." };
  const { id, inicio, fin, profesional_id } = datos.data;
  if (new Date(fin) <= new Date(inicio)) return { error: "El horario no es válido." };
  if (profesional_id && !sesion.esDueno) return { error: "Solo el dueño puede pasar un turno a otro profesional." };

  await liberarSenasVencidas(sesion.negocio.id);
  let movidos: number;
  try {
    // RLS: el empleado solo puede modificar turnos de su agenda.
    movidos = await comoUsuario(sesion.userId, (tx) =>
      tx.ejecutar(sql`
        update public.turnos
        set inicio = ${inicio}, fin = ${fin}
            ${profesional_id ? sql`, profesional_id = ${profesional_id}` : sql``}
        where id = ${id} and estado in ('pendiente', 'confirmado')`),
    );
  } catch (e) {
    return { error: mensajeDeError(e) };
  }
  if (!movidos) return { error: "No se pudo mover el turno." };

  notificarCambioTurno(id, "reprogramado");
  sincronizarGoogleDespues(id);
  revalidatePath("/panel");
  return { ok: true, mensaje: "Turno movido." };
}

const TRANSICIONES: Record<EstadoTurno, EstadoTurno[]> = {
  pendiente: ["confirmado", "cancelado", "ausente"],
  confirmado: ["completado", "cancelado", "ausente"],
  cancelado: ["confirmado"],
  completado: ["confirmado"],
  ausente: ["confirmado"],
};

export async function cambiarEstadoTurno(entrada: z.input<typeof esquemaEstadoTurno>): Promise<EstadoAccion> {
  const sesion = await sesionParaAccion();
  if (!sesion) return { error: "No tenés permiso." };
  const datos = esquemaEstadoTurno.safeParse(entrada);
  if (!datos.success) return { error: "Datos inválidos." };
  const { id, estado } = datos.data;

  let anterior: EstadoTurno;
  try {
    const r = await comoUsuario(sesion.userId, async (tx) => {
      // "for update": nadie cambia el turno entre la lectura y la escritura.
      const actual = await tx.uno<{ estado: EstadoTurno; pago_estado: EstadoPago | null }>(sql`
        select estado, pago_estado from public.turnos where id = ${id} for update`);
      if (!actual) return { error: "No se encontró el turno." };
      if (!TRANSICIONES[actual.estado].includes(estado)) return { error: "El turno ya cambió. Recargá la página." };

      // Confirmar o reactivar a mano un turno que esperaba la seña: el negocio
      // decide tomarlo igual, así que deja de vencer.
      const limpiarSena = estado !== "cancelado" && (actual.pago_estado === "pendiente" || actual.pago_estado === "vencido");
      const n = await tx.ejecutar(sql`
        update public.turnos set
          estado = ${estado},
          ${estado === "cancelado"
            ? sql`cancelado_at = now(), cancelado_por = 'negocio'`
            : sql`cancelado_at = null, cancelado_por = null`}
          ${limpiarSena ? sql`, pago_estado = null` : sql``}
        where id = ${id}`);
      if (!n) return { error: "No se encontró el turno." };
      return { anterior: actual.estado };
    });
    if ("error" in r) return { error: r.error };
    anterior = r.anterior;
  } catch (e) {
    // Reactivar un turno cancelado puede chocar con otro que tomó ese horario.
    return { error: mensajeDeError(e) };
  }

  if (estado === "cancelado") notificarCambioTurno(id, "cancelado");
  // Se le había dicho que le iban a avisar, o que el turno estaba cancelado.
  if (estado === "confirmado" && (anterior === "pendiente" || anterior === "cancelado")) {
    notificarCambioTurno(id, "confirmado");
  }
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
  let nuevoId: string | undefined;
  try {
    const fila = await comoUsuario(sesion.userId, (tx) =>
      tx.uno<{ id: string }>(sql`
        select public.crear_turno_panel(
          ${d.profesional_id}, ${d.servicio_id},
          ${localADate(d.fecha, d.hora, sesion.negocio.zona_horaria).toISOString()}::timestamptz,
          ${d.cliente_nombre}, ${d.cliente_telefono}, ${d.cliente_email ?? null}, ${d.notas ?? null}
        ) as id`),
    );
    nuevoId = fila?.id;
  } catch (e) {
    return { error: mensajeDeError(e) };
  }

  if (nuevoId) sincronizarGoogleDespues(nuevoId);
  revalidatePath("/panel", "layout");
  return { ok: true, mensaje: "Turno agendado." };
}
