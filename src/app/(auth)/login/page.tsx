import type { Metadata } from "next";
import Link from "next/link";
import { Aviso, Tarjeta } from "@/components/ui";
import { FormularioLogin } from "../formularios-auth";

export const metadata: Metadata = { title: "Ingresar" };

export default async function PaginaLogin({ searchParams }: PageProps<"/login">) {
  const { next, error, verificado, password } = await searchParams;
  return (
    <Tarjeta className="shadow-xl shadow-marca-900/5">
      <h1 className="text-3xl font-bold tracking-tight">Ingresá a tu panel</h1>
      <p className="mt-1 text-sm text-zinc-600">Para dueños y equipo de cada negocio.</p>
      {error ? (
        <Aviso tipo="error" className="mt-4">
          El link venció o ya fue usado. Ingresá con tu email y contraseña para que te mandemos uno nuevo.
        </Aviso>
      ) : verificado ? (
        <Aviso tipo="exito" className="mt-4">
          Tu email está confirmado. Ingresá con tu contraseña.
        </Aviso>
      ) : password ? (
        <Aviso tipo="exito" className="mt-4">
          Listo, guardamos tu contraseña nueva. Ingresá con ella.
        </Aviso>
      ) : null}
      <div className="mt-6">
        <FormularioLogin next={typeof next === "string" ? next : undefined} />
      </div>
      <p className="mt-6 border-t border-zinc-100 pt-5 text-center text-sm text-zinc-600">
        ¿Tenés un negocio y no tenés cuenta?{" "}
        <Link href="/registro" className="font-semibold text-marca-700 hover:underline">
          Probalo 7 días gratis
        </Link>
      </p>
    </Tarjeta>
  );
}
