import type { Metadata } from "next";
import Link from "next/link";
import { Tarjeta } from "@/components/ui";
import { FormularioCodigo } from "../../formularios-auth";

export const metadata: Metadata = { title: "Código de verificación", robots: { index: false } };

// Segundo paso del login para las cuentas con segundo factor (los admins).
export default async function PaginaCodigo({ searchParams }: PageProps<"/login/codigo">) {
  const { next } = await searchParams;
  return (
    <Tarjeta className="shadow-xl shadow-marca-900/5">
      <h1 className="text-3xl font-bold tracking-tight">Código de verificación</h1>
      <p className="mt-1 text-sm text-zinc-600">Abrí tu app autenticadora e ingresá el código de esta cuenta.</p>
      <div className="mt-6">
        <FormularioCodigo next={typeof next === "string" ? next : undefined} />
      </div>
      <p className="mt-6 border-t border-zinc-100 pt-5 text-center text-sm">
        <Link href="/login" className="font-medium text-marca-700 hover:underline">
          Volver a ingresar
        </Link>
      </p>
    </Tarjeta>
  );
}
