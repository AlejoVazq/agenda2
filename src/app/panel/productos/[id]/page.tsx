import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Aviso, EncabezadoPagina, Tarjeta } from "@/components/ui";
import { requerirDueno } from "@/lib/auth";
import { comoUsuario, sql } from "@/lib/db";
import { urlFotoProductoPanel, versionFoto } from "@/lib/productos";
import type { Producto } from "@/lib/tipos";
import { BorrarProducto, FormularioProducto } from "../formulario";
import { FotoProducto } from "./foto";

export const metadata: Metadata = { title: "Editar producto" };

export default async function EditarProducto({ params, searchParams }: PageProps<"/panel/productos/[id]">) {
  const [{ id }, { nuevo }] = await Promise.all([params, searchParams]);
  const { negocio, userId } = await requerirDueno();
  if (!z.uuid().safeParse(id).success) notFound();

  const producto = await comoUsuario(userId, (tx) =>
    tx.uno<Producto>(sql`
      select id, negocio_id, nombre, descripcion, precio, stock, activo, orden
      from public.productos where id = ${id} and negocio_id = ${negocio.id}`),
  );
  if (!producto) notFound();
  const version = await versionFoto(producto.id);

  return (
    <div className="max-w-2xl">
      <EncabezadoPagina titulo={producto.nombre} volver={{ href: "/panel/productos", texto: "Productos" }} />
      {nuevo ? (
        <Aviso tipo="exito" className="mb-4">
          Producto creado. Si querés, subile una foto.
        </Aviso>
      ) : null}
      <Tarjeta className="mb-4">
        <FotoProducto productoId={producto.id} nombre={producto.nombre} url={urlFotoProductoPanel(producto.id, version)} />
      </Tarjeta>
      <Tarjeta>
        <FormularioProducto producto={producto} />
      </Tarjeta>
      <div className="mt-6">
        <BorrarProducto id={producto.id} />
      </div>
    </div>
  );
}
