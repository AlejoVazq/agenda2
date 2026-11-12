import type { ReactNode } from "react";
import Link from "next/link";
import { Logo } from "@/components/ui";
import { cerrarSesion } from "@/app/(auth)/acciones";
import { requerirPanel } from "@/lib/auth";
import { AvisoSuscripcion } from "./aviso-suscripcion";
import { BarraInferior, MenuLateral } from "./navegacion";

// Segunda capa de seguridad: además del proxy (sesión), acá se exige que el
// usuario pertenezca a un negocio. Las páginas solo-dueño usan requerirDueno().
export default async function LayoutPanel({ children }: { children: ReactNode }) {
  const { perfil, negocio, esDueno, suscripcion } = await requerirPanel();

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-zinc-200 bg-white px-4 py-5 lg:flex">
        <Link href="/panel" className="px-2">
          <Logo />
        </Link>
        <div className="mt-6 rounded-xl bg-zinc-50 px-3 py-2.5">
          <p className="truncate text-sm font-semibold">{negocio.nombre}</p>
          <p className="text-xs text-zinc-500">
            {perfil.nombre} · {esDueno ? "Dueño/a" : "Equipo"}
          </p>
        </div>
        <div className="mt-4 flex-1 overflow-y-auto">
          <MenuLateral esDueno={esDueno} />
        </div>
        <div className="space-y-1 border-t border-zinc-100 pt-3">
          <a
            href={`/n/${negocio.slug}`}
            target="_blank"
            className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-marca-700 hover:bg-marca-50"
          >
            Ver mi página pública ↗
          </a>
          <form action={cerrarSesion}>
            <button className="w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-zinc-600 hover:bg-zinc-100">
              Cerrar sesión
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-zinc-200 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
          <Link href="/panel" className="min-w-0">
            <p className="truncate text-base font-bold">{negocio.nombre}</p>
            <p className="text-xs text-zinc-500">
              {perfil.nombre} · {esDueno ? "Dueño/a" : "Equipo"}
            </p>
          </Link>
          <form action={cerrarSesion}>
            <button className="rounded-lg px-2 py-1 text-sm font-medium text-zinc-600 hover:bg-zinc-100">Salir</button>
          </form>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-28 pt-5 sm:px-6 lg:pb-12 lg:pt-8">
          <AvisoSuscripcion suscripcion={suscripcion} esDueno={esDueno} />
          {children}
        </main>
      </div>

      <BarraInferior esDueno={esDueno} />
    </div>
  );
}
