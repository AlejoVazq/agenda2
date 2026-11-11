import { toNextJsHandler } from "better-auth/next-js";
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/better-auth";

// Por la API HTTP de Better Auth pasan solo los links de los mails. Registro,
// login, salida y cambio de contraseña van por Server Actions con zod y nuestro
// límite por IP (src/app/(auth)/acciones.ts), así que el resto de sus rutas
// queda cerrado: menos superficie expuesta.
const PERMITIDAS = [
  /^\/api\/auth\/verify-email$/, //         link de confirmación de cuenta
  /^\/api\/auth\/reset-password\/[^/]+$/, // link de recuperación → /cuenta/password?token=…
  // /^\/api\/auth\/callback\/google$/,     login con Google (cuando se sume)
];

const { GET: manejarGet } = toNextJsHandler(auth);

export async function GET(request: NextRequest) {
  if (!PERMITIDAS.some((r) => r.test(request.nextUrl.pathname))) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }
  return manejarGet(request);
}

export function POST() {
  return NextResponse.json({ error: "No encontrado" }, { status: 404 });
}
