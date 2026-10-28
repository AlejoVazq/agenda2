import type { Metadata } from "next";
import Link from "next/link";
import { Tarjeta } from "@/components/ui";
import { FormularioRegistro } from "../formularios-auth";

export const metadata: Metadata = { title: "Crear cuenta" };

export default function PaginaRegistro() {
  return (
    <Tarjeta className="shadow-xl shadow-marca-900/5">
      <h1 className="text-2xl font-bold tracking-tight">Creá la agenda de tu negocio</h1>
      <p className="mt-1 text-sm text-zinc-600">
        En 2 minutos tenés tu página de reservas. Tus clientes no necesitan registrarse.
      </p>
      <div className="mt-6">
        <FormularioRegistro />
      </div>
      <p className="mt-6 border-t border-zinc-100 pt-5 text-center text-sm text-zinc-600">
        ¿Ya tenés cuenta?{" "}
        <Link href="/login" className="font-semibold text-marca-700 hover:underline">
          Ingresá
        </Link>
      </p>
    </Tarjeta>
  );
}
