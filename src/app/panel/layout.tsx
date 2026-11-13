import type { ReactNode } from "react";
import Link from "next/link";
import { Isotipo, Logo } from "@/components/ui";
import { cerrarSesion } from "@/app/(auth)/acciones";
import { requerirPanel } from "@/lib/auth";
import { urlLogo, versionLogo } from "@/lib/logo";
import { AvisoSuscripcion } from "./aviso-suscripcion";
import { BarraInferior, MenuLateral } from "./navegacion";

// Segunda capa de seguridad: además del proxy (sesión), acá se exige que el
// usuario pertenezca a un negocio. Las páginas solo-dueño usan requerirDueno().
export default async function LayoutPanel({ children }: { children: ReactNode }) {
  const { perfil, negocio, esDueno, suscripcion } = await requerirPanel();
  const logo = urlLogo(negocio.slug, await versionLogo(negocio.id));

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-zinc-200/80 bg-white/70 px-4 py-5 backdrop-blur lg:flex">
        <Link href="/panel" className="px-2">
          <Logo />
        </Link>
        <div className="mt-6 flex items-center gap-3 rounded-2xl border border-zinc-200/80 bg-white px-3 py-2.5 shadow-suave">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- imagen propia, ya chica (≤512 px)
            <img src={logo} alt="" className="size-9 shrink-0 rounded-xl object-contain ring-1 ring-zinc-200/80" />
          ) : (
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-marca-500 to-marca-800 font-display text-sm font-bold text-white" aria-hidden>
              {negocio.nombre.trim().charAt(0).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{negocio.nombre}</p>
            <p className="truncate text-xs text-zinc-500">
              {perfil.nombre} · {esDueno ? "Dueño/a" : "Equipo"}
            </p>
          </div>
        </div>
        <div className="mt-4 flex-1 overflow-y-auto">
          <MenuLateral esDueno={esDueno} />
        </div>
        <div className="space-y-1 border-t border-zinc-100 pt-3">
          <a
            href={`/n/${negocio.slug}`}
            target="_blank"
            className="flex items-center justify-between gap-2 rounded-xl bg-marca-50 px-3 py-2.5 text-sm font-semibold text-marca-800 transition hover:bg-marca-100"
          >
            Ver mi página pública
            <svg viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden>
              <path d="M7 17 17 7M8 7h9v9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
          <form action={cerrarSesion}>
            <button className="w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-zinc-600 hover:bg-zinc-100">
              Cerrar sesión
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-zinc-200/80 bg-fondo/85 px-4 py-3 backdrop-blur-xl lg:hidden">
          <Link href="/panel" className="flex min-w-0 items-center gap-2.5">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- imagen propia, ya chica (≤512 px)
              <img src={logo} alt="" className="size-8 shrink-0 rounded-lg object-contain ring-1 ring-zinc-200/80" />
            ) : (
              <Isotipo className="size-8" />
            )}
            <span className="min-w-0">
            <p className="truncate font-display text-base font-bold">{negocio.nombre}</p>
            <p className="text-xs text-zinc-500">
              {perfil.nombre} · {esDueno ? "Dueño/a" : "Equipo"}
            </p>
            </span>
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
