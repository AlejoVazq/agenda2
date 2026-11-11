import type { Metadata } from "next";
import Link from "next/link";
import { Aviso, Logo, Tarjeta } from "@/components/ui";
import { FormularioPassword } from "@/app/(auth)/formularios-auth";

export const metadata: Metadata = { title: "Tu contraseña", robots: { index: false } };

/**
 * Destino del link de "Olvidé mi contraseña": Better Auth valida el token en
 * /api/auth/reset-password/<token> y redirige acá con ?token=… (o ?error=…).
 */
export default async function PaginaPassword({ searchParams }: PageProps<"/cuenta/password">) {
  const { token, error } = await searchParams;
  const valido = typeof token === "string" && token.length > 0 && !error;

  return (
    <div className="flex min-h-dvh flex-col bg-gradient-to-b from-marca-50 to-fondo">
      <header className="px-4 py-5 sm:px-6">
        <Link href="/" aria-label="Inicio">
          <Logo />
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-4 sm:items-center">
        <Tarjeta className="w-full max-w-md shadow-xl shadow-marca-900/5">
          <h1 className="text-2xl font-bold tracking-tight">Elegí tu contraseña</h1>
          {valido ? (
            <>
              <p className="mt-1 text-sm text-zinc-600">Después vas a ingresar con ella.</p>
              <div className="mt-6">
                <FormularioPassword token={token} />
              </div>
            </>
          ) : (
            <>
              <Aviso tipo="error" className="mt-4">
                El link venció o ya fue usado.
              </Aviso>
              <p className="mt-4 text-sm">
                <Link href="/recuperar" className="font-medium text-marca-700 hover:underline">
                  Pedir un link nuevo
                </Link>
              </p>
            </>
          )}
        </Tarjeta>
      </main>
    </div>
  );
}
