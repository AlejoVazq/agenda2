import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";

/**
 * Refresca la sesión de Supabase (si hace falta) y devuelve la respuesta con
 * las cookies actualizadas, junto con el id del usuario autenticado (o null).
 */
export async function actualizarSesion(request: NextRequest) {
  let response = NextResponse.next({ request });

  if (!env.supabaseAnonKey) {
    console.warn("[proxy] Falta NEXT_PUBLIC_SUPABASE_ANON_KEY: copiá .env.example a .env.local (ver README).");
    return { response, userId: null };
  }

  const supabase = createServerClient(
    env.supabaseUrl,
    env.supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers ?? {}).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    },
  );

  // No poner código entre createServerClient y getClaims(): getClaims valida
  // el JWT y refresca la sesión si venció.
  const { data } = await supabase.auth.getClaims();
  const userId = (data?.claims?.sub as string | undefined) ?? null;

  return { response, userId };
}
