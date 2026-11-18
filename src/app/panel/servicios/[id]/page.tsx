import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { EncabezadoPagina, Tarjeta } from "@/components/ui";
import { requerirDueno } from "@/lib/auth";
import { comoUsuario, sql } from "@/lib/db";
import type { Servicio } from "@/lib/tipos";
import { EliminarServicio, FormularioServicio } from "../formulario";

export const metadata: Metadata = { title: "Editar servicio" };

export default async function EditarServicio({ params }: PageProps<"/panel/servicios/[id]">) {
  const { id } = await params;
  const { negocio, userId } = await requerirDueno();
  if (!z.uuid().safeParse(id).success) notFound();

  const servicio = await comoUsuario(userId, (tx) =>
    tx.uno<Servicio>(sql`select * from public.servicios where id = ${id} and negocio_id = ${negocio.id}`),
  );
  if (!servicio) notFound();

  return (
    <div className="max-w-2xl">
      <EncabezadoPagina titulo={servicio.nombre} volver={{ href: "/panel/servicios", texto: "Servicios" }} />
      <Tarjeta>
        <FormularioServicio servicio={servicio} />
      </Tarjeta>
      <div className="mt-6">
        <EliminarServicio id={servicio.id} />
      </div>
    </div>
  );
}
