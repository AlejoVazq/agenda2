import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { crearSupabaseServidor } from "@/lib/supabase/server";

const TIPOS: EmailOtpType[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];

/**
 * Destino de los links de email (confirmación, invitación de empleados,
 * recuperación). Canjea el token por una sesión y redirige.
 * Soporta token_hash (recomendado para SSR) y code (PKCE).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const tipo = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next") ?? "/panel";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/panel";

  const supabase = await crearSupabaseServidor();
  let ok = false;

  if (tokenHash && tipo && TIPOS.includes(tipo)) {
    const { error } = await supabase.auth.verifyOtp({ type: tipo, token_hash: tokenHash });
    ok = !error;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  }

  const destino = request.nextUrl.clone();
  destino.search = "";
  if (ok) {
    destino.pathname = next.split("?")[0];
  } else {
    destino.pathname = "/login";
    destino.searchParams.set("error", "link");
  }
  return NextResponse.redirect(destino);
}
