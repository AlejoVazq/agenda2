import Link from "next/link";
import { MiniaturaProducto } from "@/components/miniatura-producto";
import { clasesBoton } from "@/components/ui";
import { formatPrecio } from "@/lib/fechas";
import { getNegocioPublico } from "@/lib/publico";
import { productosPublicos, tiendaPublica, urlFotoProducto } from "@/lib/productos";

/**
 * Recién reservado el turno: si el negocio vende productos, hasta 4 con stock y un botón a
 * la tienda con el turno (precarga los datos y el pedido se retira ese día).
 */
export async function Recomendados({ slug, token }: { slug: string; token: string }) {
  const negocio = await getNegocioPublico(slug);
  if (!negocio) return null;
  const [tienda, productos] = await Promise.all([tiendaPublica(negocio.id), productosPublicos(negocio.id)]);
  const conStock = productos.filter((p) => p.stock > 0).slice(0, 4);
  if (!tienda?.activa || !conStock.length) return null;
  const tiendaUrl = `/n/${slug}/productos?turno=${token}`;

  return (
    <section
      aria-labelledby="t-recomendados"
      className="mt-6 animate-aparecer rounded-[2rem] bg-white p-5 shadow-suave ring-1 ring-zinc-200/60 retraso-2"
    >
      <h2 id="t-recomendados" className="font-display text-xl font-bold leading-snug">
        ¿Querés sumar algo para retirar en tu turno?
      </h2>
      <p className="mt-1 text-sm text-zinc-600">Lo pedís ahora y te lo tienen listo cuando vayas.</p>
      <ul className="mt-4 grid grid-cols-2 gap-3">
        {conStock.map((p) => (
          <li key={p.id} className="min-w-0">
            <Link href={`${tiendaUrl}#producto-${p.id}`} className="block rounded-2xl p-1.5 transition-colors hover:bg-marca-50/60">
              <MiniaturaProducto
                nombre={p.nombre}
                url={urlFotoProducto(slug, p.id, p.foto_v)}
                className="aspect-square w-full rounded-xl text-3xl"
              />
              <p className="mt-2 line-clamp-2 text-sm font-semibold leading-snug [overflow-wrap:anywhere]">{p.nombre}</p>
              <p className="mt-0.5 text-sm font-bold tabular-nums">{formatPrecio(p.precio)}</p>
            </Link>
          </li>
        ))}
      </ul>
      <Link href={tiendaUrl} className={clasesBoton("primario", "lg", "mt-4 w-full")}>
        Ver productos
      </Link>
    </section>
  );
}
