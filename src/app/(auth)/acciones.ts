"use server";

import { redirect } from "next/navigation";
import { crearSupabaseServidor } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { datosDeForm, erroresDeCampo, esquemaLogin, esquemaPassword, esquemaRegistro } from "@/lib/validaciones";
import type { EstadoAccion } from "@/lib/tipos";

/** Solo se permiten redirecciones internas (evita open redirects). */
function destinoSeguro(next: FormDataEntryValue | null, porDefecto = "/panel") {
  const valor = typeof next === "string" ? next : "";
  return valor.startsWith("/") && !valor.startsWith("//") && !valor.includes("\\") ? valor : porDefecto;
}

export async function iniciarSesion(_prev: EstadoAccion, formData: FormData): Promise<EstadoAccion> {
  const datos = esquemaLogin.safeParse(datosDeForm(formData));
  if (!datos.success) return { errores: erroresDeCampo(datos.error) };

  const supabase = await crearSupabaseServidor();
  const { error } = await supabase.auth.signInWithPassword(datos.data);
  if (error) {
    return {
      error:
        error.code === "email_not_confirmed"
          ? "Todavía no confirmaste tu email. Revisá tu casilla."
          : "Email o contraseña incorrectos.",
    };
  }

  redirect(destinoSeguro(formData.get("next")));
}

export async function registrarse(_prev: EstadoAccion, formData: FormData): Promise<EstadoAccion> {
  const datos = esquemaRegistro.safeParse(datosDeForm(formData));
  if (!datos.success) return { errores: erroresDeCampo(datos.error) };

  const supabase = await crearSupabaseServidor();
  const { data, error } = await supabase.auth.signUp({
    email: datos.data.email,
    password: datos.data.password,
    options: {
      data: { nombre: datos.data.nombre },
      emailRedirectTo: `${env.siteUrl}/auth/confirmar?next=/onboarding`,
    },
  });

  if (error) {
    if (error.code === "user_already_exists") return { error: "Ya existe una cuenta con ese email. Iniciá sesión." };
    if (error.code === "weak_password") return { errores: { password: ["La contraseña es muy débil."] } };
    return { error: "No pudimos crear la cuenta. Probá de nuevo en unos minutos." };
  }

  // Con confirmación de email desactivada (desarrollo local) ya hay sesión.
  if (data.session) redirect("/onboarding");

  return {
    ok: true,
    mensaje: `Te enviamos un mail a ${datos.data.email}. Abrí el link para confirmar tu cuenta y seguir.`,
  };
}

export async function cerrarSesion() {
  const supabase = await crearSupabaseServidor();
  await supabase.auth.signOut();
  redirect("/login");
}

/** Definir contraseña (empleados invitados o recuperación). */
export async function definirPassword(_prev: EstadoAccion, formData: FormData): Promise<EstadoAccion> {
  const datos = esquemaPassword.safeParse(datosDeForm(formData));
  if (!datos.success) return { errores: erroresDeCampo(datos.error) };

  const supabase = await crearSupabaseServidor();
  const { error } = await supabase.auth.updateUser({ password: datos.data.password });
  if (error) {
    if (error.code === "same_password") return { error: "La contraseña nueva tiene que ser distinta a la anterior." };
    return { error: "No pudimos guardar la contraseña. Volvé a abrir el link e intentá de nuevo." };
  }

  redirect("/panel");
}

export async function pedirRecuperacion(_prev: EstadoAccion, formData: FormData): Promise<EstadoAccion> {
  const datos = esquemaLogin.pick({ email: true }).safeParse(datosDeForm(formData));
  if (!datos.success) return { errores: erroresDeCampo(datos.error) };

  const supabase = await crearSupabaseServidor();
  await supabase.auth.resetPasswordForEmail(datos.data.email, {
    redirectTo: `${env.siteUrl}/auth/confirmar?next=/cuenta/password`,
  });
  // Misma respuesta exista o no la cuenta (no revelar usuarios).
  return { ok: true, mensaje: "Si el email está registrado, te llegará un link para crear una contraseña nueva." };
}
