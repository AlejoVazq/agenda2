import type { Metadata } from "next";
import { EncabezadoPagina, Tarjeta } from "@/components/ui";
import { requerirDueno } from "@/lib/auth";
import { FormularioServicio } from "../formulario";

export const metadata: Metadata = { title: "Nuevo servicio" };

export default async function NuevoServicio() {
  await requerirDueno();
  return (
    <div className="max-w-2xl">
      <EncabezadoPagina titulo="Nuevo servicio" volver={{ href: "/panel/servicios", texto: "Servicios" }} />
      <Tarjeta>
        <FormularioServicio />
      </Tarjeta>
    </div>
  );
}
