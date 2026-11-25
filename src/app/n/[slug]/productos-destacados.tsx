import Link from "next/link";
import { MiniaturaProducto } from "@/components/miniatura-producto";
import { formatPrecio } from "@/lib/fechas";
import type { ProductoPublico } from "@/lib/productos";
import { urlFotoProducto } from "@/lib/productos";

/** Sección "Productos" de la página del negocio: hasta 6, con "Ver todos" a la tienda. */
export function ProductosDestacados({ slug, productos }: { slug: string; productos: ProductoPublico[] }) {
  const primeros = productos.slice(0, 6);
  return (
    <section
      id="productos"
      aria-labelledby="t-productos"
      className="mt-6 scroll-mt-6 rounded-[2rem] bg-white p-5 shadow-suave ring-1 ring-zinc-200/60 sm:p-6"
    >
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 id="t-productos" className="font-display text-xl font-bold">
          Productos
        </h2>
        <p className="text-sm text-zinc-500">Comprá online y retiralo acá</p>
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {primeros.map((p) => (
          <li key={p.id} className="min-w-0">
            <Link
              href={`/n/${slug}/productos#producto-${p.id}`}
              className="group block rounded-2xl p-1.5 transition-colors hover:bg-marca-50/60"
            >
              <MiniaturaProducto
                nombre={p.nombre}
                url={urlFotoProducto(slug, p.id, p.foto_v)}
                className="aspect-square w-full rounded-xl text-3xl"
              />
              <p className="mt-2 line-clamp-2 text-sm font-semibold leading-snug [overflow-wrap:anywhere]">{p.nombre}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm">
                <span className="font-bold tabular-nums">{formatPrecio(p.precio)}</span>
                {p.stock <= 0 ? <span className="text-xs font-medium text-zinc-500">Sin stock</span> : null}
              </p>
            </Link>
          </li>
        ))}
      </ul>
      <Link
        href={`/n/${slug}/productos`}
        className="mt-4 flex h-11 items-center justify-center rounded-2xl border border-zinc-200 text-sm font-semibold text-marca-800 transition hover:border-marca-300 hover:bg-marca-50/50"
      >
        {productos.length > primeros.length ? `Ver todos (${productos.length})` : "Ver productos y comprar"}
      </Link>
    </section>
  );
}
