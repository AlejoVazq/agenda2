import type { Metadata } from "next";
import Link from "next/link";
import { Tarjeta } from "@/components/ui";
import { FormularioRecuperar } from "../formularios-auth";

export const metadata: Metadata = { title: "Recuperar contraseña" };

export default function PaginaRecuperar() {
  return (
    <Tarjeta className="shadow-xl shadow-marca-900/5">
      <h1 className="text-3xl font-bold tracking-tight">Recuperar contraseña</h1>
      <p className="mt-1 text-sm text-zinc-600">Te mandamos un link para que crees una nueva.</p>
      <div className="mt-6">
        <FormularioRecuperar />
      </div>
      <p className="mt-6 text-center text-sm">
        <Link href="/login" className="font-medium text-marca-700 hover:underline">
          Volver a ingresar
        </Link>
      </p>
    </Tarjeta>
  );
}
