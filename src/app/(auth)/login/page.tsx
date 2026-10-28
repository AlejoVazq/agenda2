import type { Metadata } from "next";
import Link from "next/link";
import { Aviso, Tarjeta } from "@/components/ui";
import { FormularioLogin } from "../formularios-auth";

export const metadata: Metadata = { title: "Ingresar" };

export default async function PaginaLogin({ searchParams }: PageProps<"/login">) {
  const { next, error } = await searchParams;
  return (
    <Tarjeta className="shadow-xl shadow-marca-900/5">
      <h1 className="text-2xl font-bold tracking-tight">Ingresá a tu panel</h1>
      <p className="mt-1 text-sm text-zinc-600">Para dueños y equipo de cada negocio.</p>
      {error === "link" ? (
        <Aviso tipo="error" className="mt-4">
          El link venció o ya fue usado. Pedí uno nuevo.
        </Aviso>
      ) : null}
      <div className="mt-6">
        <FormularioLogin next={typeof next === "string" ? next : undefined} />
      </div>
      <p className="mt-6 border-t border-zinc-100 pt-5 text-center text-sm text-zinc-600">
        ¿Tenés un negocio y no tenés cuenta?{" "}
        <Link href="/registro" className="font-semibold text-marca-700 hover:underline">
          Registrate gratis
        </Link>
      </p>
    </Tarjeta>
  );
}
