import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Logo } from "@/components/ui";
import { fechaLocalISO } from "@/lib/fechas";
import { urlLogo, versionLogo } from "@/lib/logo";
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

  const logo = urlLogo(negocio.slug, await versionLogo(negocio.id));
  const iniciales = negocio.nombre
    .split(/\s+/)
    .filter((p) => /^[\p{L}\p{N}]/u.test(p))
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");

  return (
    <div className="min-h-dvh bg-fondo">
      <header className="relative overflow-hidden bg-noche bg-[radial-gradient(ellipse_70%_90%_at_100%_0%,rgb(79_146_114/0.55),transparent),radial-gradient(ellipse_60%_80%_at_0%_100%,rgb(130_180_154/0.14),transparent)] text-white">
        <div className="fondo-grano pointer-events-none absolute inset-0 opacity-60" aria-hidden />
        <div className="relative mx-auto max-w-xl px-4 pb-20 pt-8 sm:pt-12">
          <div className="flex animate-aparecer items-center gap-4">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- imagen propia, ya chica (≤512 px)
              <img
                src={logo}
                alt={`Logo de ${negocio.nombre}`}
                className="size-18 shrink-0 rounded-2xl bg-white object-contain p-1.5 shadow-[0_10px_30px_-10px_rgb(0_0_0/0.5)] ring-1 ring-white/20"
              />
            ) : (
              <span
                className="grid size-16 shrink-0 place-items-center rounded-2xl bg-white/10 font-display text-2xl font-bold ring-1 ring-white/20 backdrop-blur"
                aria-hidden
              >
                {iniciales || "·"}
              </span>
            )}
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-acento-300">
                {RUBROS[negocio.rubro as Rubro] ?? "Turnos online"}
              </p>
              <h1 className="mt-1 font-display text-3xl font-bold leading-tight tracking-tight sm:text-4xl">{negocio.nombre}</h1>
            </div>
          </div>
          {negocio.descripcion ? (
            <p className="mt-4 animate-aparecer text-[15px] leading-relaxed text-white/75 retraso-1">{negocio.descripcion}</p>
          ) : null}
          <div className="mt-5 flex animate-aparecer flex-wrap gap-2 retraso-2">
            {negocio.direccion ? (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(negocio.direccion)}`}
                target="_blank"
                className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-white/10 py-1.5 pl-2.5 pr-3.5 text-sm font-medium text-white/90 ring-1 ring-white/15 transition hover:bg-white/15"
              >
                <svg viewBox="0 0 24 24" fill="none" className="size-4 shrink-0 text-acento-300" aria-hidden>
                  <path d="M12 21s-7-6.1-7-11.5a7 7 0 1 1 14 0C19 14.9 12 21 12 21z" stroke="currentColor" strokeWidth="2" />
                  <circle cx="12" cy="9.5" r="2.5" stroke="currentColor" strokeWidth="2" />
                </svg>
                <span className="truncate">{negocio.direccion}</span>
              </a>
            ) : null}
            {negocio.telefono ? (
              <a
                href={linkWhatsApp(negocio.telefono)}
                target="_blank"
                className="inline-flex items-center gap-1.5 rounded-full bg-white/10 py-1.5 pl-2.5 pr-3.5 text-sm font-medium text-white/90 ring-1 ring-white/15 transition hover:bg-white/15"
              >
                <IconoWhatsApp className="size-4 text-emerald-300" />
                WhatsApp
              </a>
            ) : null}
          </div>
        </div>
      </header>

      <main className="relative mx-auto -mt-10 max-w-xl px-4 pb-16">
        <div className="animate-aparecer rounded-[2rem] bg-white p-4 shadow-flotante ring-1 ring-zinc-200/60 retraso-2 sm:p-6">
          {negocio.reservas_habilitadas ? (
            <Reserva negocio={negocio} hoy={fechaLocalISO(new Date(), negocio.zona_horaria)} />
          ) : (
            <div className="space-y-3 px-2 py-8 text-center">
              <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-zinc-100 text-zinc-500" aria-hidden>
                <svg viewBox="0 0 24 24" fill="none" className="size-7">
                  <rect x="4" y="5" width="16" height="15" rx="3" stroke="currentColor" strokeWidth="1.8" />
                  <path d="M8 3v4M16 3v4M4 10h16M10 14l4 4M14 14l-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </span>
              <p className="font-display text-xl font-bold">Por ahora no estamos tomando reservas online</p>
              <p className="text-sm text-zinc-600">
                {negocio.telefono ? "Escribinos por WhatsApp para coordinar tu turno." : "Comunicate con el negocio para coordinar tu turno."}
              </p>
              {negocio.telefono ? (
                <a
                  href={linkWhatsApp(negocio.telefono)}
                  target="_blank"
                  className="mt-2 inline-flex h-12 items-center gap-2 rounded-2xl bg-emerald-600 px-5 font-semibold text-white shadow-[0_8px_20px_-8px_rgb(5_150_105/0.6)] transition hover:bg-emerald-700"
                >
                  <IconoWhatsApp className="size-5" />
                  Escribir por WhatsApp
                </a>
              ) : null}
            </div>
          )}
        </div>
        <footer className="mt-10 flex justify-center">
          <Link href="/" className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs text-zinc-500 transition hover:bg-white hover:text-tinta">
            Turnos online con <Logo className="origin-left scale-[0.8]" />
          </Link>
        </footer>
      </main>
    </div>
  );
}

function IconoWhatsApp({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z" />
    </svg>
  );
}
