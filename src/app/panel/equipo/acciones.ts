"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sesionParaAccion } from "@/lib/auth";
import { crearSupabaseServidor } from "@/lib/supabase/server";
import { crearSupabaseAdmin } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { datosDeForm, erroresDeCampo, esquemaInvitacion } from "@/lib/validaciones";
import type { EstadoAccion } from "@/lib/tipos";

export type EstadoInvitacion = EstadoAccion & { link?: string };

const SIN_PERMISO = { error: "Solo el dueño puede gestionar los accesos." };

function linkDeAcceso(tokenHash: string, tipo: "invite" | "recovery") {
  const url = new URL("/auth/confirmar", env.siteUrl);
  url.searchParams.set("token_hash", tokenHash);
  url.searchParams.set("type", tipo);
  url.searchParams.set("next", "/cuenta/password");
  return url.toString();
}

/**
 * Invita a un empleado: crea su usuario (service role, porque RLS no permite
 * crear perfiles desde el cliente), lo vincula al profesional elegido y
 * devuelve un link para que defina su contraseña. El link se comparte a mano
 * (WhatsApp, etc.); el envío por mail llega en la fase de notificaciones.
 */
export async function invitarEmpleado(_prev: EstadoInvitacion, formData: FormData): Promise<EstadoInvitacion> {
  const sesion = await sesionParaAccion({ soloDueno: true });
  if (!sesion) return SIN_PERMISO;

  const datos = esquemaInvitacion.safeParse(datosDeForm(formData));
  if (!datos.success) return { errores: erroresDeCampo(datos.error) };
  const d = datos.data;

  // Verificar con la sesión del dueño (RLS) que el profesional es de su negocio y está libre.
  const supabase = await crearSupabaseServidor();
  const { data: prof } = await supabase
    .from("profesionales")
    .select("id")
    .eq("id", d.profesional_id)
    .eq("negocio_id", sesion.negocio.id)
    .maybeSingle();
  if (!prof) return { errores: { profesional_id: ["Profesional inválido."] } };
  const { data: vinculado } = await supabase.from("perfiles").select("id").eq("profesional_id", d.profesional_id).maybeSingle();
  if (vinculado) return { errores: { profesional_id: ["Ese profesional ya tiene un usuario vinculado."] } };

  const admin = crearSupabaseAdmin();
  const { data: link, error } = await admin.auth.admin.generateLink({
    type: "invite",
    email: d.email,
    options: { data: { nombre: d.nombre } },
  });
  if (error || !link.user) {
    if (error?.code === "email_exists" || error?.message?.toLowerCase().includes("already")) {
      return { errores: { email: ["Ese email ya tiene una cuenta. Cada usuario puede pertenecer a un solo negocio."] } };
    }
    return { error: "No se pudo crear la invitación. Probá de nuevo." };
  }

  const { error: errorPerfil } = await admin.from("perfiles").insert({
    id: link.user.id,
    negocio_id: sesion.negocio.id,
    rol: "empleado",
    nombre: d.nombre,
    profesional_id: d.profesional_id,
  });
  if (errorPerfil) {
    await admin.auth.admin.deleteUser(link.user.id);
    return { error: "No se pudo vincular al empleado. Probá de nuevo." };
  }

  revalidatePath("/panel/equipo");
  return {
    ok: true,
    mensaje: `Listo. Enviale este link a ${d.nombre} para que elija su contraseña:`,
    link: linkDeAcceso(link.properties.hashed_token, "invite"),
  };
}

/** Nuevo link de acceso para un empleado que perdió el suyo u olvidó la contraseña. */
export async function regenerarLink(perfilId: string): Promise<EstadoInvitacion> {
  const sesion = await sesionParaAccion({ soloDueno: true });
  if (!sesion) return SIN_PERMISO;
  if (!z.uuid().safeParse(perfilId).success) return { error: "Usuario inválido." };

  const empleado = await perfilEmpleadoDelNegocio(perfilId, sesion.negocio.id);
  if (!empleado) return { error: "Usuario inválido." };

  const admin = crearSupabaseAdmin();
  const { data: usuario } = await admin.auth.admin.getUserById(perfilId);
  if (!usuario.user?.email) return { error: "No se encontró el usuario." };

  const confirmado = Boolean(usuario.user.email_confirmed_at);
  const { data, error } = await admin.auth.admin.generateLink(
    confirmado ? { type: "recovery", email: usuario.user.email } : { type: "invite", email: usuario.user.email },
  );
  if (error) return { error: "No se pudo generar el link." };

  return {
    ok: true,
    mensaje: "Nuevo link generado:",
    link: linkDeAcceso(data.properties.hashed_token, confirmado ? "recovery" : "invite"),
  };
}

/** Quita el acceso de un empleado (borra su usuario; sus turnos quedan). */
export async function quitarAcceso(perfilId: string): Promise<EstadoAccion> {
  const sesion = await sesionParaAccion({ soloDueno: true });
  if (!sesion) return SIN_PERMISO;
  if (!z.uuid().safeParse(perfilId).success) return { error: "Usuario inválido." };

  const empleado = await perfilEmpleadoDelNegocio(perfilId, sesion.negocio.id);
  if (!empleado) return { error: "Usuario inválido." };

  const admin = crearSupabaseAdmin();
  const { error } = await admin.auth.admin.deleteUser(perfilId);
  if (error) return { error: "No se pudo quitar el acceso." };

  revalidatePath("/panel/equipo");
  return { ok: true };
}

/** Lee el perfil con la sesión del dueño (RLS): solo devuelve empleados de su negocio. */
async function perfilEmpleadoDelNegocio(perfilId: string, negocioId: string) {
  const supabase = await crearSupabaseServidor();
  const { data } = await supabase
    .from("perfiles")
    .select("id")
    .eq("id", perfilId)
    .eq("negocio_id", negocioId)
    .eq("rol", "empleado")
    .maybeSingle();
  return data;
}
