import type { Metadata } from "next";
import { EncabezadoPagina } from "@/components/ui";
import { requerirDueno } from "@/lib/auth";
import { env } from "@/lib/env";
import { urlLogo, versionLogo } from "@/lib/logo";
import { aparienciaNegocio, urlPortada } from "@/lib/portada";
import { AparienciaNegocio } from "./apariencia";
import { FormularioNegocio } from "./formulario";
import { LogoNegocio } from "./logo";

export const metadata: Metadata = { title: "Mi negocio" };

export default async function PaginaNegocio() {
  const { negocio } = await requerirDueno();
  const [versionDelLogo, apariencia] = await Promise.all([versionLogo(negocio.id), aparienciaNegocio(negocio.id)]);
  const logo = urlLogo(negocio.slug, versionDelLogo);
  return (
    <div className="max-w-3xl">
      <EncabezadoPagina titulo="Mi negocio" descripcion="Datos públicos y reglas de reserva." />
      <div className="mb-6">
        <LogoNegocio url={logo} nombre={negocio.nombre} />
      </div>
      <div className="mb-6">
        <AparienciaNegocio
          nombre={negocio.nombre}
          logo={logo}
          portada={urlPortada(negocio.slug, apariencia.portada)}
          color={apariencia.color}
        />
      </div>
      <FormularioNegocio negocio={negocio} siteUrl={env.siteUrl} />
    </div>
  );
}
