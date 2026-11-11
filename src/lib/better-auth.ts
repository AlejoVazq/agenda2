import "server-only";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { Pool } from "pg";
import { env } from "@/lib/env";
import { MARCA } from "@/lib/marca";
import { enviarEmail } from "@/lib/email/enviar";
import { emailRestablecerPassword, emailVerificarCuenta } from "@/lib/email/plantillas";

// Better Auth: cuentas, sesiones y mails de verificación / recuperación.
// Guarda todo en el esquema auth de nuestro Postgres, con su propio pool que
// entra como agenda2_auth (solo ve ese esquema). La sesión viaja en una cookie
// httpOnly, Secure en producción y SameSite=Lax.
//
// Las pantallas no llaman a su API HTTP: usan Server Actions con zod que llaman
// a auth.api.* (src/app/(auth)/acciones.ts). Por /api/auth solo pasan los links
// de los mails (ver src/app/api/auth/[...all]/route.ts).

const global = globalThis as unknown as { __agenda2PoolAuth?: Pool };

function poolAuth() {
  if (!global.__agenda2PoolAuth) {
    // El pool no se conecta hasta la primera consulta: el build no necesita la base.
    if (!env.databaseUrl && process.env.NEXT_PHASE !== "phase-production-build") {
      console.error("[auth] Falta DATABASE_URL en el entorno del servidor (ver .env.example).");
    }
    global.__agenda2PoolAuth = new Pool({
      connectionString: env.databaseUrl,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      application_name: "agenda2-auth",
      options: "-c role=agenda2_auth -c search_path=auth -c TimeZone=UTC",
    });
    global.__agenda2PoolAuth.on("error", (e) => console.error("[auth] error en una conexión inactiva", e));
  }
  return global.__agenda2PoolAuth;
}

/** Envía sin esperar: Better Auth recomienda no demorar la respuesta (evita medir tiempos). */
function enviarSinEsperar(email: Parameters<typeof enviarEmail>[0]) {
  void enviarEmail(email).catch((e) => console.error("[auth] no se pudo enviar el mail", e));
}

const produccion = process.env.NODE_ENV === "production";

export const auth = betterAuth({
  appName: MARCA.nombre,
  baseURL: process.env.BETTER_AUTH_URL ?? env.siteUrl,
  // Al compilar no hace falta el secreto real (no se firma nada). En ejecución,
  // si falta, Better Auth corta con error: nunca arranca con uno por defecto.
  secret:
    process.env.BETTER_AUTH_SECRET ??
    (process.env.NEXT_PHASE === "phase-production-build" ? "solo-para-compilar-no-se-usa-en-ejecucion" : undefined),
  trustedOrigins: [env.siteUrl],
  database: poolAuth(),

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 8,
    maxPasswordLength: 72,
    autoSignIn: false,
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: 60 * 60,
    sendResetPassword: async ({ user, url }) => {
      enviarSinEsperar(emailRestablecerPassword(user.email, { nombre: user.name, url }));
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    expiresIn: 24 * 60 * 60,
    sendVerificationEmail: async ({ user, url }) => {
      enviarSinEsperar(emailVerificarCuenta(user.email, { nombre: user.name, url }));
    },
  },

  session: {
    expiresIn: 30 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
  },

  // Límite de intentos para lo que entra por /api/auth (los links de los mails).
  // Las Server Actions de login, registro y recuperación usan además el nuestro
  // por IP (src/lib/limites.ts).
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 30,
  },

  advanced: {
    database: { generateId: "uuid" },
    cookiePrefix: "agenda2",
    useSecureCookies: produccion,
    // Caddy pisa X-Forwarded-For con la IP real (ver CLAUDE.md, "Publicar").
    ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
  },

  // Login con Google (opcional, para más adelante): sumar
  //   socialProviders: { google: { clientId, clientSecret } }
  // con la redirect https://<dominio>/api/auth/callback/google y habilitar esa
  // ruta en src/app/api/auth/[...all]/route.ts.

  // nextCookies tiene que ir último: deja que las Server Actions escriban la cookie.
  plugins: [nextCookies()],
});
