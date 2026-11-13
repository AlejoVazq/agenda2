import type { Metadata } from "next";
import { EncabezadoPagina } from "@/components/ui";
import { requerirDueno } from "@/lib/auth";
import { env } from "@/lib/env";
import { urlLogo, versionLogo } from "@/lib/logo";
import { FormularioNegocio } from "./formulario";
import { LogoNegocio } from "./logo";

export const metadata: Metadata = { title: "Mi negocio" };

export default async function PaginaNegocio() {
  const { negocio } = await requerirDueno();
  const logo = urlLogo(negocio.slug, await versionLogo(negocio.id));
  return (
    <div className="max-w-3xl">
      <EncabezadoPagina titulo="Mi negocio" descripcion="Datos públicos y reglas de reserva." />
      <div className="mb-6">
        <LogoNegocio url={logo} nombre={negocio.nombre} />
      </div>
      <FormularioNegocio negocio={negocio} siteUrl={env.siteUrl} />
    </div>
  );
}
