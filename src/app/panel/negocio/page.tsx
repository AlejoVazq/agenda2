import type { Metadata } from "next";
import { EncabezadoPagina } from "@/components/ui";
import { requerirDueno } from "@/lib/auth";
import { env, integracionesDisponibles } from "@/lib/env";
import { buscarIntegracion } from "@/lib/integraciones";
import { urlLogo, versionLogo } from "@/lib/logo";
import { aparienciaNegocio, urlPortada } from "@/lib/portada";
import { AparienciaNegocio } from "./apariencia";
import { FormularioNegocio } from "./formulario";
import { LogoNegocio } from "./logo";
import { TiendaNegocio } from "./tienda";

export const metadata: Metadata = { title: "Mi negocio" };

export default async function PaginaNegocio() {
  const { negocio } = await requerirDueno();
  const mpOfrecido = integracionesDisponibles().mercadopago;
  const [versionDelLogo, apariencia, mp] = await Promise.all([
    versionLogo(negocio.id),
    aparienciaNegocio(negocio.id),
    mpOfrecido ? buscarIntegracion(negocio.id, "mercadopago").catch(() => null) : null,
  ]);
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
      <div className="mt-6">
        <TiendaNegocio negocio={negocio} mpOfrecido={mpOfrecido} mpConectado={mp?.estado === "activa"} />
      </div>
    </div>
  );
}
