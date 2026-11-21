import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cx } from "@/components/ui";
import { estiloTema } from "@/lib/apariencia";
import { aparienciaNegocio } from "@/lib/portada";
import { getNegocioPublico } from "@/lib/publico";
import { resenasPublicas, resumenResenas } from "@/lib/resenas";
import { formatPromedio, ListaOpiniones, ResumenOpiniones, textoCantidad } from "@/components/opiniones";

import { OpinarSinTurno } from "../opinar";

const POR_PAGINA = 20;

export async function generateMetadata({ params }: PageProps<"/n/[slug]/opiniones">): Promise<Metadata> {
  const { slug } = await params;
  const negocio = await getNegocioPublico(slug);
  if (!negocio) return { title: "Negocio no encontrado" };
  const r = await resumenResenas(negocio.id);
  return {
    title: `Opiniones de ${negocio.nombre}`,
    description: r.promedio !== null ? `${formatPromedio(r.promedio)} de 5 en ${textoCantidad(r.cantidad)}.` : undefined,
  };
}

export default async function PaginaOpiniones({ params, searchParams }: PageProps<"/n/[slug]/opiniones">) {
  const { slug } = await params;
  const negocio = await getNegocioPublico(slug);
  if (!negocio) notFound();
  const [resumen, apariencia] = await Promise.all([resumenResenas(negocio.id), aparienciaNegocio(negocio.id)]);
  if (!resumen.activas) notFound();

  const pedida = Number((await searchParams).pagina);
  const paginas = Math.max(1, Math.ceil(resumen.cantidad / POR_PAGINA));
  const pagina = Number.isInteger(pedida) && pedida >= 1 && pedida <= paginas ? pedida : 1;
  const lista = await resenasPublicas(negocio.id, { limite: POR_PAGINA, desplazamiento: (pagina - 1) * POR_PAGINA });
  const tema = estiloTema(apariencia.color);
  const enlace = (p: number) => (p === 1 ? `/n/${slug}/opiniones` : `/n/${slug}/opiniones?pagina=${p}`);

  return (
    <div className={cx("min-h-dvh bg-fondo", tema && "tema-negocio")} style={tema}>
      <main className="mx-auto max-w-xl px-4 pb-16 pt-6">
        <Link
          href={`/n/${slug}`}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-semibold text-marca-800 transition hover:bg-white"
        >
          <svg viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden>
            <path d="m15 6-6 6 6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Volver a {negocio.nombre}
        </Link>
        <h1 className="mt-4 font-display text-3xl font-bold tracking-tight">Opiniones</h1>
        <p className="mt-1 text-sm text-zinc-600">Lo que cuentan los clientes de {negocio.nombre}.</p>

        <div className="mt-6 rounded-[2rem] bg-white p-5 shadow-suave ring-1 ring-zinc-200/60 sm:p-6">
          {resumen.promedio === null ? (
            <p className="pb-4 pt-2 text-center text-sm text-zinc-600">Todavía no hay opiniones.</p>
          ) : (
            <>
              <ResumenOpiniones resumen={resumen} />
              <div className="mt-6 border-t border-zinc-100 pt-5">
                <ListaOpiniones resenas={lista} negocio={negocio.nombre} tz={negocio.zona_horaria} />
              </div>
            </>
          )}
          <div className={cx(resumen.promedio !== null && "mt-6 border-t border-zinc-100 pt-5")}>
            <OpinarSinTurno negocioId={negocio.id} slug={negocio.slug} profesionales={negocio.profesionales} />
          </div>
        </div>

        {paginas > 1 ? (
          <nav className="mt-6 flex items-center justify-between text-sm" aria-label="Páginas">
            {pagina > 1 ? (
              <Link href={enlace(pagina - 1)} className="rounded-xl px-3 py-2 font-semibold text-marca-800 hover:bg-white">
                ← Más nuevas
              </Link>
            ) : (
              <span />
            )}
            <span className="text-zinc-500">
              Página {pagina} de {paginas}
            </span>
            {pagina < paginas ? (
              <Link href={enlace(pagina + 1)} className="rounded-xl px-3 py-2 font-semibold text-marca-800 hover:bg-white">
                Más viejas →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}

        <div className="mt-8 text-center">
          <Link
            href={`/n/${slug}`}
            className="inline-flex h-12 items-center rounded-2xl bg-marca-700 px-6 font-semibold text-white shadow-[0_8px_20px_-8px_rgb(31_77_58/0.6)] transition hover:bg-marca-800"
          >
            Reservar turno
          </Link>
        </div>
      </main>
    </div>
  );
}
