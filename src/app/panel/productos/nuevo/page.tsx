import type { Metadata } from "next";
import { EncabezadoPagina, Tarjeta } from "@/components/ui";
import { requerirDueno } from "@/lib/auth";
import { FormularioProducto } from "../formulario";

export const metadata: Metadata = { title: "Nuevo producto" };

export default async function NuevoProducto() {
  await requerirDueno();
  return (
    <div className="max-w-2xl">
      <EncabezadoPagina titulo="Nuevo producto" volver={{ href: "/panel/productos", texto: "Productos" }} />
      <Tarjeta>
        <FormularioProducto />
      </Tarjeta>
      <p className="mt-3 text-sm text-zinc-500">La foto la subís después de crearlo.</p>
    </div>
  );
}
