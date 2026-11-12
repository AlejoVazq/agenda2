"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

type Item = { href: string; texto: string; icono: keyof typeof ICONOS; soloDueno?: boolean; movil?: boolean };

const ITEMS: Item[] = [
  { href: "/panel", texto: "Inicio", icono: "inicio", movil: true },
  { href: "/panel/agenda", texto: "Agenda", icono: "agenda", movil: true },
  { href: "/panel/turnos", texto: "Turnos", icono: "lista", movil: true },
  { href: "/panel/servicios", texto: "Servicios", icono: "servicios", soloDueno: true },
  { href: "/panel/profesionales", texto: "Profesionales", icono: "equipo", soloDueno: true },
  { href: "/panel/bloqueos", texto: "Ausencias", icono: "bloqueo" },
  { href: "/panel/clientes", texto: "Clientes", icono: "clientes", soloDueno: true },
  { href: "/panel/estadisticas", texto: "Estadísticas", icono: "grafico", soloDueno: true },
  { href: "/panel/integraciones", texto: "Integraciones", icono: "enchufe" },
  { href: "/panel/equipo", texto: "Accesos", icono: "llave", soloDueno: true },
  { href: "/panel/negocio", texto: "Mi negocio", icono: "ajustes", soloDueno: true },
];

const ICONOS = {
  inicio: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  agenda: "M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM8 2v4M16 2v4M4 10h16",
  lista: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  servicios: "m14.5 4-9 9 5.5 5.5 9-9V4zM16.5 7.5h.01",
  equipo: "M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 20v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  bloqueo: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM4.9 4.9l14.2 14.2",
  clientes: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  llave: "M15 7a4 4 0 1 1-3.9 4.9L3 20v-3h3v-3h3l1.1-1.1A4 4 0 0 1 15 7zM16 9h.01",
  ajustes: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  mas: "M5 12h.01M12 12h.01M19 12h.01",
  grafico: "M3 3v18h18M8 17v-5M13 17V8M18 17v-8",
  enchufe: "M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5",
};

function Icono({ nombre, className }: { nombre: keyof typeof ICONOS; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={cx("size-5", className)} aria-hidden>
      <path d={ICONOS[nombre]} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function activo(pathname: string, href: string) {
  return href === "/panel" ? pathname === "/panel" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Menú lateral (escritorio). */
export function MenuLateral({ esDueno }: { esDueno: boolean }) {
  const pathname = usePathname();
  return (
    <nav className="space-y-1">
      {ITEMS.filter((i) => esDueno || !i.soloDueno).map((i) => (
        <Link
          key={i.href}
          href={i.href}
          className={cx(
            "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
            activo(pathname, i.href)
              ? "bg-tinta text-white shadow-[0_6px_16px_-8px_rgb(26_21_35/0.6)] [&_svg]:text-coral-300"
              : "text-zinc-600 hover:bg-zinc-100 hover:text-tinta",
          )}
        >
          <Icono nombre={i.icono} />
          {i.texto}
        </Link>
      ))}
    </nav>
  );
}

/** Barra inferior (móvil) con los accesos principales + "Más". */
export function BarraInferior({ esDueno }: { esDueno: boolean }) {
  const pathname = usePathname();
  const principales = ITEMS.filter((i) => i.movil);
  const resto = ITEMS.filter((i) => !i.movil && (esDueno || !i.soloDueno));
  const enResto = resto.some((i) => activo(pathname, i.href));

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200/80 bg-white/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
      <div className="grid grid-cols-4">
        {principales.map((i) => (
          <Link
            key={i.href}
            href={i.href}
            className={cx(
              "flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold",
              activo(pathname, i.href) ? "text-marca-700" : "text-zinc-500",
            )}
          >
            <Icono nombre={i.icono} />
            {i.texto}
          </Link>
        ))}
        <details className="group relative">
          <summary
            className={cx(
              "flex cursor-pointer list-none flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold [&::-webkit-details-marker]:hidden",
              enResto ? "text-marca-700" : "text-zinc-500",
            )}
          >
            <Icono nombre="mas" />
            Más
          </summary>
          <div className="absolute bottom-full right-2 mb-2 w-56 rounded-2xl border border-zinc-200 bg-white p-2 shadow-xl">
            {resto.map((i) => (
              <Link
                key={i.href}
                href={i.href}
                onClick={(e) => e.currentTarget.closest("details")?.removeAttribute("open")}
                className={cx(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium",
                  activo(pathname, i.href) ? "bg-marca-100 text-marca-800" : "text-zinc-700 hover:bg-zinc-100",
                )}
              >
                <Icono nombre={i.icono} />
                {i.texto}
              </Link>
            ))}
          </div>
        </details>
      </div>
    </nav>
  );
}
