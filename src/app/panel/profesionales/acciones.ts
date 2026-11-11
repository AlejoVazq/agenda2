"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { sesionParaAccion } from "@/lib/auth";
import { comoUsuario, esErrorPg, sql } from "@/lib/db";
import { mensajeDeError } from "@/lib/errores";
import { datosDeForm, erroresDeCampo, esquemaFranjas, esquemaProfesional } from "@/lib/validaciones";
import type { EstadoAccion } from "@/lib/tipos";

const SIN_PERMISO: EstadoAccion = { error: "Solo el dueño del negocio puede modificar el equipo." };
const idValido = (id: string) => z.uuid().safeParse(id).success;

export async function guardarProfesional(
  id: string | null,
  _prev: EstadoAccion,
  formData: FormData,
): Promise<EstadoAccion> {
  const sesion = await sesionParaAccion({ soloDueno: true });
  if (!sesion) return SIN_PERMISO;
  if (id && !idValido(id)) return { error: "Profesional inválido." };

  const datos = esquemaProfesional.safeParse(datosDeForm(formData));
  if (!datos.success) return { errores: erroresDeCampo(datos.error) };
  const d = datos.data;

  if (id) {
    try {
      await comoUsuario(sesion.userId, (tx) =>
        tx.ejecutar(sql`
          update public.profesionales
          set nombre = ${d.nombre}, email = ${d.email ?? null}, color = ${d.color}, activo = ${d.activo}
          where id = ${id} and negocio_id = ${sesion.negocio.id}`),
      );
    } catch (e) {
      return { error: mensajeDeError(e) };
    }
    revalidatePath(`/panel/profesionales/${id}`);
    return { ok: true, mensaje: "Datos guardados." };
  }

  let nuevoId: string;
  try {
    const fila = await comoUsuario(sesion.userId, (tx) =>
      tx.uno<{ id: string }>(sql`
        insert into public.profesionales (negocio_id, nombre, email, color, activo)
        values (${sesion.negocio.id}, ${d.nombre}, ${d.email ?? null}, ${d.color}, ${d.activo})
        returning id`),
    );
    nuevoId = fila!.id;
  } catch (e) {
    return { error: mensajeDeError(e) };
  }

  revalidatePath("/panel/profesionales");
  redirect(`/panel/profesionales/${nuevoId}?nuevo=1`);
}

export async function guardarServiciosProfesional(
  id: string,
  _prev: EstadoAccion,
  formData: FormData,
): Promise<EstadoAccion> {
  const sesion = await sesionParaAccion({ soloDueno: true });
  if (!sesion) return SIN_PERMISO;
  if (!idValido(id)) return { error: "Profesional inválido." };

  const ids = z.array(z.uuid()).max(200).safeParse(formData.getAll("servicio_id"));
  if (!ids.success) return { error: "Selección inválida." };

  try {
    await comoUsuario(sesion.userId, (tx) =>
      tx.ejecutar(sql`select public.guardar_servicios_profesional(${id}, ${ids.data}::uuid[])`),
    );
  } catch (e) {
    return { error: mensajeDeError(e) };
  }

  revalidatePath(`/panel/profesionales/${id}`);
  return { ok: true, mensaje: "Servicios actualizados." };
}

export async function guardarHorarios(id: string, _prev: EstadoAccion, formData: FormData): Promise<EstadoAccion> {
  const sesion = await sesionParaAccion({ soloDueno: true });
  if (!sesion) return SIN_PERMISO;
  if (!idValido(id)) return { error: "Profesional inválido." };

  let crudo: unknown;
  try {
    crudo = JSON.parse(String(formData.get("franjas") ?? "[]"));
  } catch {
    return { error: "Formato de horarios inválido." };
  }
  const franjas = esquemaFranjas.safeParse(crudo);
  if (!franjas.success) return { error: franjas.error.issues[0]?.message ?? "Horarios inválidos." };

  try {
    await comoUsuario(sesion.userId, (tx) =>
      tx.ejecutar(sql`select public.guardar_horarios(${id}, ${JSON.stringify(franjas.data)}::jsonb)`),
    );
  } catch (e) {
    return { error: mensajeDeError(e) };
  }

  revalidatePath(`/panel/profesionales/${id}`);
  return { ok: true, mensaje: "Horarios guardados." };
}

export async function eliminarProfesional(id: string): Promise<EstadoAccion> {
  const sesion = await sesionParaAccion({ soloDueno: true });
  if (!sesion) return SIN_PERMISO;
  if (!idValido(id)) return { error: "Profesional inválido." };

  try {
    await comoUsuario(sesion.userId, (tx) =>
      tx.ejecutar(sql`delete from public.profesionales where id = ${id} and negocio_id = ${sesion.negocio.id}`),
    );
  } catch (e) {
    if (esErrorPg(e) && e.code === "23503") {
      return { error: "Este profesional tiene turnos registrados. En lugar de borrarlo, desactivalo." };
    }
    return { error: mensajeDeError(e) };
  }

  revalidatePath("/panel/profesionales");
  redirect("/panel/profesionales");
}
