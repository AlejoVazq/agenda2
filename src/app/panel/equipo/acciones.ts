"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sesionParaAccion } from "@/lib/auth";
import { borrarUsuario, crearLinkAcceso, crearUsuarioEmpleado, tieneContrasena } from "@/lib/accesos";
import { comoServidor, comoUsuario, sql } from "@/lib/db";
import { datosDeForm, erroresDeCampo, esquemaInvitacion } from "@/lib/validaciones";
import type { EstadoAccion } from "@/lib/tipos";

export type EstadoInvitacion = EstadoAccion & { link?: string };

const SIN_PERMISO = { error: "Solo el dueño puede gestionar los accesos." };

/**
 * Invita a un empleado: crea su usuario, lo vincula al profesional elegido y
 * devuelve un link para que elija su contraseña. El link se comparte a mano
 * (WhatsApp, etc.).
 */
export async function invitarEmpleado(_prev: EstadoInvitacion, formData: FormData): Promise<EstadoInvitacion> {
  const sesion = await sesionParaAccion({ soloDueno: true });
  if (!sesion) return SIN_PERMISO;

  const datos = esquemaInvitacion.safeParse(datosDeForm(formData));
  if (!datos.success) return { errores: erroresDeCampo(datos.error) };
  const d = datos.data;

  // Con la sesión del dueño (RLS): el profesional es de su negocio y está libre.
  const prof = await comoUsuario(sesion.userId, (tx) =>
    tx.uno<{ id: string; vinculado: boolean }>(sql`
      select p.id, exists (select 1 from public.perfiles x where x.profesional_id = p.id) as vinculado
      from public.profesionales p
      where p.id = ${d.profesional_id} and p.negocio_id = ${sesion.negocio.id}`),
  );
  if (!prof) return { errores: { profesional_id: ["Profesional inválido."] } };
  if (prof.vinculado) return { errores: { profesional_id: ["Ese profesional ya tiene un usuario vinculado."] } };

  let usuarioId: string | null;
  try {
    usuarioId = await crearUsuarioEmpleado(d.email, d.nombre);
  } catch (e) {
    console.error("[equipo] no se pudo crear el usuario", e);
    return { error: "No se pudo crear la invitación. Probá de nuevo." };
  }
  if (!usuarioId) {
    return { errores: { email: ["Ese email ya tiene una cuenta. Cada usuario puede pertenecer a un solo negocio."] } };
  }

  try {
    // Crear perfiles no lo permite RLS: lo hace el servidor, ya verificado el dueño.
    await comoServidor((tx) =>
      tx.ejecutar(sql`
        insert into public.perfiles (id, negocio_id, rol, nombre, profesional_id)
        values (${usuarioId}, ${sesion.negocio.id}, 'empleado', ${d.nombre}, ${d.profesional_id})`),
    );
    const link = await crearLinkAcceso(usuarioId, "invitacion");
    revalidatePath("/panel/equipo");
    return { ok: true, mensaje: `Listo. Enviale este link a ${d.nombre} para que elija su contraseña:`, link };
  } catch (e) {
    console.error("[equipo] no se pudo vincular al empleado", e);
    await borrarUsuario(usuarioId).catch(() => null);
    return { error: "No se pudo vincular al empleado. Probá de nuevo." };
  }
}

/** Nuevo link de acceso para un empleado que perdió el suyo u olvidó la contraseña. */
export async function regenerarLink(perfilId: string): Promise<EstadoInvitacion> {
  const sesion = await sesionParaAccion({ soloDueno: true });
  if (!sesion) return SIN_PERMISO;
  if (!z.uuid().safeParse(perfilId).success) return { error: "Usuario inválido." };

  const empleado = await perfilEmpleadoDelNegocio(sesion.userId, perfilId, sesion.negocio.id);
  if (!empleado) return { error: "Usuario inválido." };

  try {
    const tipo = (await tieneContrasena(perfilId)) ? "recuperacion" : "invitacion";
    const link = await crearLinkAcceso(perfilId, tipo);
    return { ok: true, mensaje: "Nuevo link generado:", link };
  } catch (e) {
    console.error("[equipo] no se pudo generar el link", e);
    return { error: "No se pudo generar el link." };
  }
}

/** Quita el acceso de un empleado (borra su usuario; sus turnos quedan). */
export async function quitarAcceso(perfilId: string): Promise<EstadoAccion> {
  const sesion = await sesionParaAccion({ soloDueno: true });
  if (!sesion) return SIN_PERMISO;
  if (!z.uuid().safeParse(perfilId).success) return { error: "Usuario inválido." };

  const empleado = await perfilEmpleadoDelNegocio(sesion.userId, perfilId, sesion.negocio.id);
  if (!empleado) return { error: "Usuario inválido." };

  try {
    await borrarUsuario(perfilId);
  } catch (e) {
    console.error("[equipo] no se pudo quitar el acceso", e);
    return { error: "No se pudo quitar el acceso." };
  }

  revalidatePath("/panel/equipo");
  return { ok: true };
}

/** Lee el perfil con la sesión del dueño (RLS): solo devuelve empleados de su negocio. */
async function perfilEmpleadoDelNegocio(usuarioId: string, perfilId: string, negocioId: string) {
  return comoUsuario(usuarioId, (tx) =>
    tx.uno<{ id: string }>(sql`
      select id from public.perfiles
      where id = ${perfilId} and negocio_id = ${negocioId} and rol = 'empleado'`),
  );
}
