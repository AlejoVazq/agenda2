import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Logo } from "@/components/ui";
import { fechaLocalISO } from "@/lib/fechas";
import { getNegocioPublico, linkWhatsApp } from "@/lib/publico";
import { RUBROS, type Rubro } from "@/lib/tipos";
import { Reserva } from "./reserva";

export async function generateMetadata({ params }: PageProps<"/n/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const negocio = await getNegocioPublico(slug);
  if (!negocio) return { title: "Negocio no encontrado" };
  return {
    title: `Reservá tu turno en ${negocio.nombre}`,
    description: negocio.descripcion ?? `Turnos online en ${negocio.nombre}.`,
  };
}

export default async function PaginaNegocio({ params }: PageProps<"/n/[slug]">) {
  const { slug } = await params;
  const negocio = await getNegocioPublico(slug);
  if (!negocio) notFound();

  return (
    <div className="min-h-dvh bg-fondo">
      <header className="bg-gradient-to-br from-marca-800 via-marca-700 to-marca-600 text-white">
        <div className="mx-auto max-w-xl px-4 pb-14 pt-8">
          <p className="text-xs font-semibold uppercase tracking-wider text-marca-200">
            {RUBROS[negocio.rubro as Rubro] ?? "Turnos online"}
          </p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight">{negocio.nombre}</h1>
          {negocio.descripcion ? <p className="mt-2 text-sm text-marca-100">{negocio.descripcion}</p> : null}
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm text-marca-100">
            {negocio.direccion ? (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(negocio.direccion)}`}
                target="_blank"
                className="hover:underline"
              >
                📍 {negocio.direccion}
              </a>
            ) : null}
            {negocio.telefono ? (
              <a href={linkWhatsApp(negocio.telefono)} target="_blank" className="hover:underline">
                💬 WhatsApp
              </a>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto -mt-8 max-w-xl px-4 pb-16">
        <div className="rounded-3xl bg-white p-4 shadow-xl shadow-marca-900/10 sm:p-6">
          <Reserva negocio={negocio} hoy={fechaLocalISO(new Date(), negocio.zona_horaria)} />
        </div>
        <footer className="mt-8 flex justify-center">
          <Link href="/" className="opacity-60 transition hover:opacity-100">
            <span className="mr-1 align-middle text-xs text-zinc-500">Turnos con</span>
            <Logo className="scale-75 align-middle" />
          </Link>
        </footer>
      </main>
    </div>
  );
}
