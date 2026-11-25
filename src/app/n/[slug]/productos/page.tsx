import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cx } from "@/components/ui";
import { estiloTema } from "@/lib/apariencia";
import { turnoParaPedido } from "@/lib/pedidos";
import { aparienciaNegocio } from "@/lib/portada";
import { productosPublicos, tiendaPublica, urlFotoProducto } from "@/lib/productos";
import { getNegocioPublico, linkWhatsApp } from "@/lib/publico";
import { Tienda, type ProductoTienda } from "./tienda";

export async function generateMetadata({ params, searchParams }: PageProps<"/n/[slug]/productos">): Promise<Metadata> {
  const { slug } = await params;
  const negocio = await getNegocioPublico(slug);
  if (!negocio) return { title: "Negocio no encontrado" };
  const meta: Metadata = { title: `Productos de ${negocio.nombre}`, description: `Comprá online y retiralo en ${negocio.nombre}.` };
  // Con ?turno= la URL lleva el token del turno: que no se indexe ni viaje como referer.
  if ((await searchParams).turno !== undefined) return { ...meta, robots: { index: false }, referrer: "no-referrer" };
  return meta;
}

export default async function PaginaProductos({ params, searchParams }: PageProps<"/n/[slug]/productos">) {
  const { slug } = await params;
  const negocio = await getNegocioPublico(slug);
  if (!negocio) notFound();
  const sp = await searchParams;
  const tokenTurno = typeof sp.turno === "string" ? sp.turno : null;

  const [tienda, lista, apariencia, turno] = await Promise.all([
    tiendaPublica(negocio.id),
    productosPublicos(negocio.id),
    aparienciaNegocio(negocio.id),
    tokenTurno ? turnoParaPedido(tokenTurno, negocio.id) : null,
  ]);
  const tema = estiloTema(apariencia.color);
  const productos: ProductoTienda[] = lista.map((p) => ({
    id: p.id,
    nombre: p.nombre,
    descripcion: p.descripcion,
    precio: p.precio,
    stock: p.stock,
    foto: urlFotoProducto(negocio.slug, p.id, p.foto_v),
  }));
  const abierta = Boolean(tienda?.activa) && productos.length > 0;

  return (
    <div className={cx("min-h-dvh bg-fondo", tema && "tema-negocio")} style={tema}>
      <main className="mx-auto max-w-xl px-4 pb-32 pt-6">
        <Link
          href={turno ? `/t/${turno.token}` : `/n/${slug}`}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-semibold text-marca-800 transition hover:bg-white"
        >
          <svg viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden>
            <path d="m15 6-6 6 6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {turno ? "Volver a tu turno" : `Volver a ${negocio.nombre}`}
        </Link>
        <h1 className="mt-4 animate-aparecer font-display text-3xl font-bold tracking-tight">Productos</h1>
        <p className="mt-1 animate-aparecer text-sm text-zinc-600 retraso-1">
          Elegí lo que quieras y retiralo en {negocio.nombre}. No hace falta crear una cuenta.
        </p>

        {abierta && tienda ? (
          <Tienda
            negocio={{ id: negocio.id, slug: negocio.slug, nombre: negocio.nombre, zona_horaria: negocio.zona_horaria }}
            productos={productos}
            tienda={tienda}
            turno={turno}
          />
        ) : (
          <div className="mt-6 animate-aparecer space-y-3 rounded-[2rem] bg-white px-5 py-10 text-center shadow-suave ring-1 ring-zinc-200/60 retraso-2">
            <p className="font-display text-xl font-bold">Por ahora no hay productos a la venta</p>
            <p className="text-sm text-zinc-600">
              {negocio.telefono ? "Escribinos por WhatsApp si buscás algo en particular." : "Consultá en el local."}
            </p>
            {negocio.telefono ? (
              <a
                href={linkWhatsApp(negocio.telefono)}
                target="_blank"
                className="inline-block text-sm font-semibold text-marca-700 underline underline-offset-2"
              >
                Escribir por WhatsApp
              </a>
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
}
