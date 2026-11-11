"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sesionParaAccion } from "@/lib/auth";
import { comoUsuario, sql } from "@/lib/db";
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

  try {
    await comoUsuario(sesion.userId, (tx) =>
      tx.ejecutar(sql`
        insert into public.bloqueos (negocio_id, profesional_id, inicio, fin, motivo)
        values (${sesion.negocio.id}, ${d.profesional_id}, ${localADate(fDesde, hDesde, tz).toISOString()},
                ${localADate(fHasta, hHasta, tz).toISOString()}, ${d.motivo ?? null})`),
    );
  } catch (e) {
    return { error: mensajeDeError(e) };
  }

  revalidatePath("/panel/bloqueos");
  return { ok: true, mensaje: "Ausencia guardada. Esos horarios ya no se ofrecen online." };
}

export async function eliminarBloqueo(id: string): Promise<EstadoAccion> {
  const sesion = await sesionParaAccion();
  if (!sesion) return { error: "No tenés permiso." };
  if (!z.uuid().safeParse(id).success) return { error: "Ausencia inválida." };

  try {
    // RLS: el empleado solo borra las de su agenda.
    await comoUsuario(sesion.userId, (tx) =>
      tx.ejecutar(sql`delete from public.bloqueos where id = ${id} and negocio_id = ${sesion.negocio.id}`),
    );
  } catch (e) {
    return { error: mensajeDeError(e) };
  }

  revalidatePath("/panel/bloqueos");
  return { ok: true };
}
