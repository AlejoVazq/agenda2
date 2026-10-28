import type { Metadata } from "next";
import { EncabezadoPagina, Tarjeta } from "@/components/ui";
import { requerirDueno } from "@/lib/auth";
import { FormularioProfesional } from "../formularios";

export const metadata: Metadata = { title: "Nuevo profesional" };

export default async function NuevoProfesional() {
  await requerirDueno();
  return (
    <div className="max-w-2xl">
      <EncabezadoPagina
        titulo="Nuevo profesional"
        descripcion="Después de crearlo vas a poder elegir sus servicios y horarios."
        volver={{ href: "/panel/profesionales", texto: "Profesionales" }}
      />
      <Tarjeta>
        <FormularioProfesional />
      </Tarjeta>
    </div>
  );
}
