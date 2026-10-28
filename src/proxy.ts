import { NextResponse, type NextRequest } from "next/server";
import { actualizarSesion } from "@/lib/supabase/proxy";

// Primera capa de seguridad (la segunda es el layout/acciones del panel, que
// verifican perfil y rol en el servidor; la tercera es RLS en la base).
const RUTAS_PRIVADAS = ["/panel", "/onboarding", "/cuenta"];
const RUTAS_SOLO_INVITADOS = ["/login", "/registro"];

function coincide(pathname: string, rutas: string[]) {
  return rutas.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

export async function proxy(request: NextRequest) {
  const { response, userId } = await actualizarSesion(request);
  const { pathname, search } = request.nextUrl;

  if (!userId && coincide(pathname, RUTAS_PRIVADAS)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", `${pathname}${search}`);
    return redirigirConCookies(url, response);
  }

  if (userId && coincide(pathname, RUTAS_SOLO_INVITADOS)) {
    const url = request.nextUrl.clone();
    url.pathname = "/panel";
    url.search = "";
    return redirigirConCookies(url, response);
  }

  return response;
}

// Conserva las cookies de sesión refrescadas al redirigir.
function redirigirConCookies(url: URL, base: NextResponse) {
  const redirect = NextResponse.redirect(url);
  base.cookies.getAll().forEach((c) => redirect.cookies.set(c));
  return redirect;
}

export const config = {
  matcher: [
    // Todo menos archivos estáticos e imágenes.
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
