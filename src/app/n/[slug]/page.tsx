import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cx, Logo } from "@/components/ui";
import { estiloTema } from "@/lib/apariencia";
import { fechaLocalISO } from "@/lib/fechas";
import { urlLogo, versionLogo } from "@/lib/logo";
import { aparienciaNegocio, urlPortada } from "@/lib/portada";
import { productosPublicos, tiendaPublica } from "@/lib/productos";
import { getNegocioPublico, linkWhatsApp } from "@/lib/publico";
import { resenasPublicas, resumenResenas } from "@/lib/resenas";
import { Estrellas } from "@/components/estrellas";
import { formatPromedio, ListaOpiniones, ResumenOpiniones, textoCantidad } from "@/components/opiniones";
import { RUBROS, type Rubro } from "@/lib/tipos";
import { IconoWhatsApp } from "@/components/icono-whatsapp";
import { OpinarSinTurno } from "./opinar";
import { ProductosDestacados } from "./productos-destacados";
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

  const [versionDelLogo, apariencia, resenas, tienda, productos] = await Promise.all([
    versionLogo(negocio.id),
    aparienciaNegocio(negocio.id),
    resumenResenas(negocio.id),
    tiendaPublica(negocio.id),
    productosPublicos(negocio.id),
  ]);
  const ultimas = resenas.cantidad ? await resenasPublicas(negocio.id, { limite: 5, soloConComentario: true }) : [];
  const logo = urlLogo(negocio.slug, versionDelLogo);
  const portada = urlPortada(negocio.slug, apariencia.portada);
  const tema = estiloTema(apariencia.color);
  const iniciales = negocio.nombre
    .split(/\s+/)
    .filter((p) => /^[\p{L}\p{N}]/u.test(p))
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");

  return (
    <div className={cx("min-h-dvh bg-fondo", tema && "tema-negocio")} style={tema}>
      <header
        className={cx(
          "relative overflow-hidden text-white",
          tema
            ? "cabecera-tema"
            : "bg-noche bg-[radial-gradient(ellipse_70%_90%_at_100%_0%,rgb(79_146_114/0.55),transparent),radial-gradient(ellipse_60%_80%_at_0%_100%,rgb(130_180_154/0.14),transparent)]",
        )}
      >
        {portada ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- imagen propia, ya achicada al subirla */}
            <img src={portada} alt="" className="absolute inset-0 size-full object-cover" fetchPriority="high" />
            <div className="velo-portada absolute inset-0" aria-hidden />
          </>
        ) : null}
        <div className="fondo-grano pointer-events-none absolute inset-0 opacity-60" aria-hidden />
        <div className={cx("relative mx-auto max-w-xl px-4 pb-20", portada ? "pt-24 sm:pt-32" : "pt-8 sm:pt-12")}>
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
              <p className={cx("text-xs font-semibold uppercase tracking-[0.16em]", tema || portada ? "text-white/80" : "text-acento-300")}>
                {RUBROS[negocio.rubro as Rubro] ?? "Turnos online"}
              </p>
              <h1 className="mt-1 font-display text-3xl font-bold leading-tight tracking-tight sm:text-4xl">{negocio.nombre}</h1>
              {resenas.promedio !== null ? (
                <a
                  href="#opiniones"
                  className="mt-1.5 inline-flex items-center gap-1.5 text-sm text-white/85 transition hover:text-white"
                >
                  <Estrellas valor={resenas.promedio} className="size-4" />
                  <span className="font-bold tabular-nums text-white">{formatPromedio(resenas.promedio)}</span>
                  <span className="underline decoration-white/40 underline-offset-2">({textoCantidad(resenas.cantidad)})</span>
                </a>
              ) : null}
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
            {negocio.instagram ? (
              <a
                href={`https://www.instagram.com/${negocio.instagram}/`}
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-1.5 rounded-full bg-white/10 py-1.5 pl-2.5 pr-3.5 text-sm font-medium text-white/90 ring-1 ring-white/15 transition hover:bg-white/15"
              >
                <svg viewBox="0 0 24 24" fill="none" className="size-4 shrink-0 text-pink-300" aria-hidden>
                  <rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" strokeWidth="2" />
                  <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
                  <circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" />
                </svg>
                Instagram
              </a>
            ) : null}
          </div>
        </div>
      </header>

      <main className="relative mx-auto -mt-10 max-w-xl px-4 pb-16">
        <div className="animate-aparecer rounded-[2rem] bg-white p-4 shadow-flotante ring-1 ring-zinc-200/60 retraso-2 sm:p-6">
          {negocio.reservas_habilitadas ? (
            <Reserva negocio={negocio} hoy={fechaLocalISO(new Date(), negocio.zona_horaria)} valoraciones={resenas.porProfesional} />
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
        {tienda?.activa && productos.length ? <ProductosDestacados slug={negocio.slug} productos={productos} /> : null}
        {resenas.activas ? (
          <section
            id="opiniones"
            aria-labelledby="t-opiniones"
            className="mt-6 scroll-mt-6 rounded-[2rem] bg-white p-5 shadow-suave ring-1 ring-zinc-200/60 sm:p-6"
          >
            <h2 id="t-opiniones" className="mb-4 font-display text-xl font-bold">
              Opiniones
            </h2>
            {resenas.promedio !== null ? (
              <>
                <ResumenOpiniones resumen={resenas} />
                {ultimas.length ? (
                  <div className="mt-6 border-t border-zinc-100 pt-5">
                    <ListaOpiniones resenas={ultimas} negocio={negocio.nombre} tz={negocio.zona_horaria} />
                  </div>
                ) : null}
                <Link
                  href={`/n/${negocio.slug}/opiniones`}
                  className="mt-5 flex h-11 items-center justify-center rounded-2xl border border-zinc-200 text-sm font-semibold text-marca-800 transition hover:border-marca-300 hover:bg-marca-50/50"
                >
                  Ver todas las opiniones
                </Link>
              </>
            ) : (
              <div className="flex items-center gap-3 rounded-2xl bg-zinc-50 px-4 py-4 ring-1 ring-zinc-100">
                <Estrellas valor={0} className="size-4" etiqueta="Sin opiniones todavía" />
                <p className="text-sm text-zinc-600">Todavía no hay opiniones. ¡Contá cómo te fue y sé la primera persona en opinar!</p>
              </div>
            )}
            <div className="mt-4">
              <OpinarSinTurno negocioId={negocio.id} slug={negocio.slug} profesionales={negocio.profesionales} />
            </div>
          </section>
        ) : null}
        <footer className="mt-10 flex justify-center">
          <Link href="/" className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs text-zinc-500 transition hover:bg-white hover:text-tinta">
            Turnos online con <Logo className="origin-left scale-[0.8]" />
          </Link>
        </footer>
      </main>
    </div>
  );
}
