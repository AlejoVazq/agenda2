import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { auth } from "@/lib/better-auth";

// Primera capa de seguridad (la segunda es el layout/acciones del panel, que
// verifican perfil y rol en el servidor; la tercera es RLS en la base).
const RUTAS_PRIVADAS = ["/panel", "/onboarding", "/admin"];
const RUTAS_SOLO_INVITADOS = ["/login", "/registro"];

function coincide(pathname: string, rutas: string[]) {
  return rutas.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

/** ¿Hay una sesión válida? Sin cookie ni se consulta la base. */
async function haySesion(request: NextRequest) {
  if (!getSessionCookie(request, { cookiePrefix: "agenda2" })) return false;
  const sesion = await auth.api.getSession({ headers: request.headers }).catch(() => null);
  return Boolean(sesion?.user);
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (coincide(pathname, RUTAS_PRIVADAS) && !(await haySesion(request))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  if (coincide(pathname, RUTAS_SOLO_INVITADOS) && (await haySesion(request))) {
    const url = request.nextUrl.clone();
    url.pathname = "/panel";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/panel/:path*", "/onboarding/:path*", "/admin/:path*", "/login", "/registro"],
};
