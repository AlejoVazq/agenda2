import type { Metadata } from "next";
import { EncabezadoPagina } from "@/components/ui";
import { requerirDueno } from "@/lib/auth";
import { env } from "@/lib/env";
import { FormularioNegocio } from "./formulario";

export const metadata: Metadata = { title: "Mi negocio" };

export default async function PaginaNegocio() {
  const { negocio } = await requerirDueno();
  return (
    <div className="max-w-3xl">
      <EncabezadoPagina titulo="Mi negocio" descripcion="Datos públicos y reglas de reserva." />
      <FormularioNegocio negocio={negocio} siteUrl={env.siteUrl} />
    </div>
  );
}
