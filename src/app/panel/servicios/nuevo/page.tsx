import type { Metadata } from "next";
import { EncabezadoPagina, Tarjeta } from "@/components/ui";
import { requerirDueno } from "@/lib/auth";
import { comoUsuario, sql } from "@/lib/db";
import { FormularioServicio } from "../formulario";

export const metadata: Metadata = { title: "Nuevo servicio" };

export default async function NuevoServicio() {
  const { negocio, userId } = await requerirDueno();
  const profesionales = await comoUsuario(userId, (tx) =>
    tx.varios<{ id: string; nombre: string }>(sql`
      select id, nombre from public.profesionales
      where negocio_id = ${negocio.id} and activo order by orden, nombre`),
  );
  return (
    <div className="max-w-2xl">
      <EncabezadoPagina titulo="Nuevo servicio" volver={{ href: "/panel/servicios", texto: "Servicios" }} />
      <Tarjeta>
        <FormularioServicio profesionales={profesionales} asignaciones={[]} />
      </Tarjeta>
    </div>
  );
}
