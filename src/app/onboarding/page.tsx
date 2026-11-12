import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo, Tarjeta } from "@/components/ui";
import { cerrarSesion } from "@/app/(auth)/acciones";
import { esAdministrador, getSesion, getSesionPanel } from "@/lib/auth";
import { env } from "@/lib/env";
import { FormularioOnboarding } from "./formulario";

export const metadata: Metadata = { title: "Tu negocio" };

export default async function PaginaOnboarding() {
  const sesion = await getSesion();
  if (!sesion) redirect("/login");
  if (await getSesionPanel()) redirect("/panel");
  // Las cuentas de administrador no tienen negocio.
  if (await esAdministrador(sesion.userId)) redirect("/admin");

  const nombre = sesion.nombre;

  return (
    <div className="flex min-h-dvh flex-col bg-gradient-to-b from-marca-50 to-fondo">
      <header className="flex items-center justify-between px-4 py-5 sm:px-6">
        <Logo />
        <form action={cerrarSesion}>
          <button className="text-sm font-medium text-zinc-600 hover:text-tinta">Salir</button>
        </form>
      </header>
      <main className="flex flex-1 justify-center px-4 pb-16">
        <div className="w-full max-w-lg">
          <p className="text-sm font-semibold text-marca-700">Paso 1 de 1</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Contanos de tu negocio</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Después vas a cargar tus servicios, tu equipo y los horarios de atención.
          </p>
          <Tarjeta className="mt-6 shadow-xl shadow-marca-900/5">
            <FormularioOnboarding nombreUsuario={nombre} siteUrl={env.siteUrl} />
          </Tarjeta>
        </div>
      </main>
    </div>
  );
}
