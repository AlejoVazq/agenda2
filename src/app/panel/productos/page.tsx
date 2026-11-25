import type { Metadata } from "next";
import Link from "next/link";
import { MiniaturaProducto } from "@/components/miniatura-producto";
import { Aviso, BotonLink, EncabezadoPagina, Insignia, Vacio } from "@/components/ui";
import { requerirDueno } from "@/lib/auth";
import { comoUsuario, sql } from "@/lib/db";
import { formatPrecio } from "@/lib/fechas";
import { urlFotoProductoPanel, versionesFotosProductos } from "@/lib/productos";
import type { Producto } from "@/lib/tipos";

export const metadata: Metadata = { title: "Productos" };

export default async function PaginaProductos() {
  const { negocio, userId } = await requerirDueno();
  const [lista, fotos] = await Promise.all([
    comoUsuario(userId, (tx) =>
      tx.varios<Producto>(sql`
        select id, negocio_id, nombre, descripcion, precio, stock, activo, orden
        from public.productos where negocio_id = ${negocio.id} order by orden, nombre, id`),
    ),
    versionesFotosProductos(negocio.id),
  ]);

  return (
    <>
      <EncabezadoPagina
        titulo="Productos"
        descripcion="Lo que vendés en tu local: tus clientes lo piden desde tu página."
        acciones={<BotonLink href="/panel/productos/nuevo">+ Nuevo producto</BotonLink>}
      />
      {!negocio.tienda_activa && lista.length > 0 ? (
        <Aviso tipo="alerta" className="mb-4">
          La tienda está apagada: tus clientes todavía no ven los productos.{" "}
          <Link href="/panel/negocio#tienda" className="font-semibold underline">
            Prendela en Mi negocio
          </Link>
          .
        </Aviso>
      ) : null}
      {lista.length === 0 ? (
        <Vacio
          titulo="Todavía no cargaste productos"
          descripcion="Agregá cada producto con su precio y cuántos tenés, así tus clientes los piden desde tu página."
          accion={<BotonLink href="/panel/productos/nuevo">Crear el primero</BotonLink>}
        />
      ) : (
        <ul className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
          {lista.map((p) => (
            <li key={p.id}>
              <Link href={`/panel/productos/${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-50">
                <MiniaturaProducto nombre={p.nombre} url={urlFotoProductoPanel(p.id, fotos.get(p.id))} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{p.nombre}</p>
                  <p className="text-sm text-zinc-500">
                    {formatPrecio(p.precio)} · Disponible: {p.stock}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {p.stock === 0 ? <Insignia color="rojo">Sin stock</Insignia> : null}
                  {!p.activo ? <Insignia>Inactivo</Insignia> : null}
                </div>
                <span className="text-zinc-400">›</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
