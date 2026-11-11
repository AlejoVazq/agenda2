"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { canjearLinkAcceso } from "@/lib/accesos";
import { auth } from "@/lib/better-auth";
import { dentroDelLimite } from "@/lib/limites";
import { datosDeForm, erroresDeCampo, esquemaPassword } from "@/lib/validaciones";
import type { EstadoAccion } from "@/lib/tipos";

/** El empleado elige su contraseña con el link que le pasó el dueño y entra al panel. */
export async function usarLinkAcceso(_prev: EstadoAccion, formData: FormData): Promise<EstadoAccion> {
  const datos = esquemaPassword.safeParse(datosDeForm(formData));
  if (!datos.success) return { errores: erroresDeCampo(datos.error) };
  const token = formData.get("token");
  if (typeof token !== "string") return { error: "El link no es válido." };
  if (!(await dentroDelLimite("acceso", 10, 600))) {
    return { error: "Hiciste demasiados intentos. Esperá unos minutos y probá de nuevo." };
  }

  let email: string | null;
  try {
    email = await canjearLinkAcceso(token, datos.data.password);
  } catch (e) {
    console.error("[acceso]", e);
    return { error: "No pudimos guardar la contraseña. Probá de nuevo." };
  }
  if (!email) return { error: "El link venció o ya fue usado. Pedile uno nuevo a quien administra el negocio." };

  try {
    await auth.api.signInEmail({ body: { email, password: datos.data.password }, headers: await headers() });
  } catch {
    redirect("/login?password=1");
  }
  redirect("/panel");
}
