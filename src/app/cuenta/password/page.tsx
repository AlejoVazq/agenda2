import type { Metadata } from "next";
import Link from "next/link";
import { Logo, Tarjeta } from "@/components/ui";
import { FormularioPassword } from "@/app/(auth)/formularios-auth";
import { getSesion } from "@/lib/auth";

export const metadata: Metadata = { title: "Tu contraseña" };

export default async function PaginaPassword() {
  const sesion = await getSesion();
  return (
    <div className="flex min-h-dvh flex-col bg-gradient-to-b from-marca-50 to-fondo">
      <header className="px-4 py-5 sm:px-6">
        <Link href="/panel" aria-label="Panel">
          <Logo />
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-4 sm:items-center">
        <Tarjeta className="w-full max-w-md shadow-xl shadow-marca-900/5">
          <h1 className="text-2xl font-bold tracking-tight">Elegí tu contraseña</h1>
          <p className="mt-1 text-sm text-zinc-600">
            {sesion?.email ? <>Para ingresar como <strong>{sesion.email}</strong>.</> : "Para ingresar a tu panel."}
          </p>
          <div className="mt-6">
            <FormularioPassword />
          </div>
        </Tarjeta>
      </main>
    </div>
  );
}
