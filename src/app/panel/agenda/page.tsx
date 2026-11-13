import type { Metadata } from "next";
import { Aviso, EncabezadoPagina } from "@/components/ui";
import { requerirPanel } from "@/lib/auth";
import { comoUsuario, sql } from "@/lib/db";
import type { Profesional, Servicio } from "@/lib/tipos";
import { Agenda } from "./agenda";

export const metadata: Metadata = { title: "Agenda" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PaginaAgenda({ searchParams }: PageProps<"/panel/agenda">) {
  const { nuevo, cliente: clienteId } = await searchParams;
  const { negocio, perfil, esDueno, userId } = await requerirPanel();

  // "+ Turno" desde la ficha de un cliente (solo el dueño lee fichas; RLS lo vuelve a filtrar).
  const cliente =
    esDueno && typeof clienteId === "string" && UUID.test(clienteId)
      ? await comoUsuario(userId, (tx) =>
          tx.uno<{ nombre: string; telefono: string; email: string | null }>(sql`
            select nombre, telefono, email from public.clientes where id = ${clienteId}`),
        )
      : null;

  const [profs, servs, asign] = await comoUsuario(userId, (tx) =>
    Promise.all([
      tx.varios<Pick<Profesional, "id" | "nombre" | "color">>(sql`
        select id, nombre, color from public.profesionales
        where negocio_id = ${negocio.id} and activo order by orden, nombre`),
      tx.varios<Pick<Servicio, "id" | "nombre" | "duracion_min">>(sql`
        select id, nombre, duracion_min from public.servicios
        where negocio_id = ${negocio.id} and activo order by orden, nombre`),
      tx.varios<{ profesional_id: string; servicio_id: string }>(sql`
        select profesional_id, servicio_id from public.profesional_servicio where negocio_id = ${negocio.id}`),
    ]),
  );

  const sinAgenda = !esDueno && !perfil.profesional_id;

  return (
    <>
      <EncabezadoPagina
        titulo="Agenda"
        descripcion={
          esDueno ? "Arrastrá un turno para moverlo. Tocá un hueco para agendar." : "Tus turnos. Arrastrá uno para moverlo."
        }
      />
      {sinAgenda ? (
        <Aviso tipo="alerta">Tu usuario no está vinculado a una agenda. Pedile al dueño del negocio que lo vincule.</Aviso>
      ) : (
        <Agenda
          tz={negocio.zona_horaria}
          esDueno={esDueno}
          miProfesionalId={perfil.profesional_id}
          profesionales={profs}
          servicios={servs}
          asignaciones={asign}
          abrirNuevo={nuevo === "1"}
          clienteNuevo={cliente ?? undefined}
          nombreNegocio={negocio.nombre}
        />
      )}
    </>
  );
}
