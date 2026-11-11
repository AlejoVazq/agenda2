import type { Metadata } from "next";
import Link from "next/link";
import { Aviso, Logo, Tarjeta } from "@/components/ui";
import { FormularioPassword } from "@/app/(auth)/formularios-auth";
import { verLinkAcceso } from "@/lib/accesos";
import { usarLinkAcceso } from "./acciones";

export const metadata: Metadata = { title: "Tu acceso", robots: { index: false } };

/** Link de un solo uso que el dueño le pasa a un empleado (invitación o contraseña olvidada). */
export default async function PaginaAcceso({ params }: PageProps<"/acceso/[token]">) {
  const { token } = await params;
  const acceso = await verLinkAcceso(token);

  return (
    <div className="flex min-h-dvh flex-col bg-gradient-to-b from-marca-50 to-fondo">
      <header className="px-4 py-5 sm:px-6">
        <Link href="/" aria-label="Inicio">
          <Logo />
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-4 sm:items-center">
        <Tarjeta className="w-full max-w-md shadow-xl shadow-marca-900/5">
          <h1 className="text-2xl font-bold tracking-tight">
            {acceso?.tipo === "recuperacion" ? "Elegí una contraseña nueva" : "Elegí tu contraseña"}
          </h1>
          {acceso ? (
            <>
              <p className="mt-1 text-sm text-zinc-600">
                Hola {acceso.nombre.split(" ")[0]}. Vas a ingresar como <strong>{acceso.email}</strong>.
              </p>
              <div className="mt-6">
                <FormularioPassword token={token} accion={usarLinkAcceso} />
              </div>
            </>
          ) : (
            <Aviso tipo="error" className="mt-4">
              El link venció o ya fue usado. Pedile uno nuevo a quien administra el negocio.
            </Aviso>
          )}
        </Tarjeta>
      </main>
    </div>
  );
}
