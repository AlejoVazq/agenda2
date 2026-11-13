import type { ReactNode } from "react";
import Link from "next/link";
import { Logo } from "@/components/ui";

const PUNTOS = [
  "Tu página de reservas abierta las 24 horas",
  "Recordatorios automáticos por mail",
  "Cada profesional con su propia agenda",
];

export default function LayoutAuth({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh lg:grid lg:grid-cols-[1fr_1fr] xl:grid-cols-[1.1fr_0.9fr]">
      <div className="relative flex flex-1 flex-col">
        <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden lg:hidden" aria-hidden>
          <div className="absolute -right-24 -top-24 size-80 rounded-full bg-marca-200/50 blur-3xl" />
          <div className="absolute -left-24 top-1/2 size-72 rounded-full bg-acento-100/70 blur-3xl" />
        </div>
        <header className="px-4 py-5 sm:px-8">
          <Link href="/" aria-label="Inicio" className="inline-block">
            <Logo />
          </Link>
        </header>
        <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-4 sm:items-center sm:pt-0">
          <div className="w-full max-w-md animate-aparecer">{children}</div>
        </main>
      </div>

      {/* Panel de marca (solo escritorio) */}
      <aside className="relative hidden overflow-hidden bg-noche bg-[radial-gradient(ellipse_80%_60%_at_100%_0%,rgb(79_146_114/0.6),transparent),radial-gradient(ellipse_70%_60%_at_0%_100%,rgb(226_98_43/0.3),transparent)] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="fondo-puntos pointer-events-none absolute inset-0" aria-hidden />
        <p className="relative text-sm font-semibold uppercase tracking-[0.16em] text-acento-300">Turnos online</p>
        <div className="relative">
          <p className="max-w-md font-display text-5xl font-bold leading-[1.05] tracking-tight">
            Menos mensajes. <span className="text-white/50">Más clientes atendidos.</span>
          </p>
          <ul className="mt-10 space-y-4">
            {PUNTOS.map((p) => (
              <li key={p} className="flex items-center gap-3 text-white/80">
                <span className="grid size-7 place-items-center rounded-full bg-white/10 ring-1 ring-white/15">
                  <svg viewBox="0 0 24 24" fill="none" className="size-4 text-acento-300" aria-hidden>
                    <path d="m5 12 5 5L20 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                {p}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-white/50">Hecho en Argentina, para negocios de acá.</p>
      </aside>
    </div>
  );
}
