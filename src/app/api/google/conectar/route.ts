import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { env, integracionesDisponibles } from "@/lib/env";
import { urlAutorizacionGoogle } from "@/lib/google";
import { sesionConPermisoSobreProfesional } from "@/lib/permisos";

// Inicia la conexión con Google: guarda un "state" aleatorio en una cookie
// (protección CSRF del flujo OAuth) y manda al usuario a la pantalla de Google.
export async function GET(request: NextRequest) {
  const volver = new URL("/panel/integraciones", env.siteUrl);
  if (!integracionesDisponibles().google) {
    volver.searchParams.set("google", "no-configurado");
    return NextResponse.redirect(volver);
  }

  const profesionalId = request.nextUrl.searchParams.get("profesional") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(profesionalId)) return NextResponse.redirect(volver);

  const sesion = await sesionConPermisoSobreProfesional(profesionalId);
  if (!sesion) {
    volver.searchParams.set("google", "sin-permiso");
    return NextResponse.redirect(volver);
  }

  const state = randomBytes(24).toString("base64url");
  const respuesta = NextResponse.redirect(urlAutorizacionGoogle(state, sesion.perfil.profesional_id === profesionalId ? sesion.email : null));
  respuesta.cookies.set("google_oauth", `${state}.${profesionalId}`, {
    httpOnly: true,
    secure: env.siteUrl.startsWith("https://"),
    sameSite: "lax",
    path: "/api/google",
    maxAge: 600,
  });
  return respuesta;
}
