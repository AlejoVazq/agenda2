"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { APIError } from "better-auth/api";
import { auth } from "@/lib/better-auth";
import { dentroDelLimite } from "@/lib/limites";
import { datosDeForm, erroresDeCampo, esquemaLogin, esquemaPassword, esquemaRegistro } from "@/lib/validaciones";
import type { EstadoAccion } from "@/lib/tipos";

const DEMASIADOS = { error: "Hiciste demasiados intentos. Esperá unos minutos y probá de nuevo." };

/** Solo se permiten redirecciones internas (evita open redirects). */
function destinoSeguro(next: FormDataEntryValue | null, porDefecto = "/panel") {
  const valor = typeof next === "string" ? next : "";
  return valor.startsWith("/") && !valor.startsWith("//") && !valor.includes("\\") ? valor : porDefecto;
}

function codigoDe(e: unknown): string | undefined {
  return e instanceof APIError ? (e.body?.code as string | undefined) : undefined;
}

export async function iniciarSesion(_prev: EstadoAccion, formData: FormData): Promise<EstadoAccion> {
  const datos = esquemaLogin.safeParse(datosDeForm(formData));
  if (!datos.success) return { errores: erroresDeCampo(datos.error) };
  if (!(await dentroDelLimite("login", 10, 600))) return DEMASIADOS;

  try {
    await auth.api.signInEmail({
      body: { email: datos.data.email, password: datos.data.password },
      headers: await headers(),
    });
  } catch (e) {
    if (codigoDe(e) === "EMAIL_NOT_VERIFIED") {
      return { error: "Todavía no confirmaste tu email. Te reenviamos el link: revisá tu casilla." };
    }
    if (!(e instanceof APIError)) console.error("[login]", e);
    return { error: "Email o contraseña incorrectos." };
  }

  redirect(destinoSeguro(formData.get("next")));
}

export async function registrarse(_prev: EstadoAccion, formData: FormData): Promise<EstadoAccion> {
  const datos = esquemaRegistro.safeParse(datosDeForm(formData));
  if (!datos.success) return { errores: erroresDeCampo(datos.error) };
  if (!(await dentroDelLimite("registro", 5, 3600))) return DEMASIADOS;

  try {
    // Con la verificación de mail obligatoria, Better Auth responde igual exista o
    // no la cuenta (no revela qué emails están registrados).
    await auth.api.signUpEmail({
      body: {
        name: datos.data.nombre,
        email: datos.data.email,
        password: datos.data.password,
        callbackURL: "/login?verificado=1",
      },
      headers: await headers(),
    });
  } catch (e) {
    const codigo = codigoDe(e);
    if (codigo === "PASSWORD_TOO_SHORT" || codigo === "PASSWORD_TOO_LONG") {
      return { errores: { password: ["La contraseña debe tener entre 8 y 72 caracteres."] } };
    }
    if (!(e instanceof APIError)) console.error("[registro]", e);
    return { error: "No pudimos crear la cuenta. Probá de nuevo en unos minutos." };
  }

  return {
    ok: true,
    mensaje: `Te enviamos un mail a ${datos.data.email}. Abrí el link para confirmar tu cuenta y seguir.`,
  };
}

export async function cerrarSesion() {
  await auth.api.signOut({ headers: await headers() }).catch(() => null);
  redirect("/login");
}

/** Elegir contraseña nueva con el link de recuperación que llega por mail. */
export async function restablecerPassword(_prev: EstadoAccion, formData: FormData): Promise<EstadoAccion> {
  const datos = esquemaPassword.safeParse(datosDeForm(formData));
  if (!datos.success) return { errores: erroresDeCampo(datos.error) };
  const token = formData.get("token");
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{8,200}$/.test(token)) {
    return { error: "El link no es válido. Pedí uno nuevo." };
  }
  if (!(await dentroDelLimite("restablecer", 10, 600))) return DEMASIADOS;

  try {
    await auth.api.resetPassword({ body: { newPassword: datos.data.password, token }, headers: await headers() });
  } catch (e) {
    if (!(e instanceof APIError)) console.error("[restablecer]", e);
    return { error: "El link venció o ya se usó. Pedí uno nuevo desde “Olvidé mi contraseña”." };
  }

  redirect("/login?password=1");
}

export async function pedirRecuperacion(_prev: EstadoAccion, formData: FormData): Promise<EstadoAccion> {
  const datos = esquemaLogin.pick({ email: true }).safeParse(datosDeForm(formData));
  if (!datos.success) return { errores: erroresDeCampo(datos.error) };
  if (!(await dentroDelLimite("recuperar", 5, 3600))) return DEMASIADOS;

  await auth.api
    .requestPasswordReset({ body: { email: datos.data.email, redirectTo: "/cuenta/password" }, headers: await headers() })
    .catch((e) => {
      if (!(e instanceof APIError)) console.error("[recuperar]", e);
    });
  // Misma respuesta exista o no la cuenta (no revelar usuarios).
  return { ok: true, mensaje: "Si el email está registrado, te llegará un link para crear una contraseña nueva." };
}
