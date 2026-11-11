import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Aviso, EncabezadoPagina, Tarjeta } from "@/components/ui";
import { requerirDueno } from "@/lib/auth";
import { comoUsuario, sql } from "@/lib/db";
import type { Horario, Profesional, Servicio } from "@/lib/tipos";
import {
  EditorHorarios,
  EliminarProfesional,
  FormularioProfesional,
  FormularioServiciosProfesional,
} from "../formularios";

export const metadata: Metadata = { title: "Profesional" };

export default async function PaginaProfesional({ params, searchParams }: PageProps<"/panel/profesionales/[id]">) {
  const { id } = await params;
  const { nuevo } = await searchParams;
  const { negocio, userId } = await requerirDueno();
  if (!z.uuid().safeParse(id).success) notFound();

  const [profesional, servicios, asignados, horarios] = await comoUsuario(userId, (tx) =>
    Promise.all([
      tx.uno<Profesional>(sql`select * from public.profesionales where id = ${id} and negocio_id = ${negocio.id}`),
      tx.varios<Servicio>(sql`select * from public.servicios where negocio_id = ${negocio.id} order by orden, nombre`),
      tx.varios<{ servicio_id: string }>(sql`select servicio_id from public.profesional_servicio where profesional_id = ${id}`),
      tx.varios<Horario>(sql`
        select * from public.horarios_profesional where profesional_id = ${id} order by dia_semana, desde`),
    ]),
  );
  if (!profesional) notFound();

  return (
    <div className="max-w-3xl space-y-6">
      <EncabezadoPagina titulo={profesional.nombre} volver={{ href: "/panel/profesionales", texto: "Profesionales" }} />

      {nuevo ? (
        <Aviso tipo="exito">Profesional creado. Ahora elegí qué servicios hace y en qué horarios atiende.</Aviso>
      ) : null}

      <Tarjeta>
        <h2 className="text-lg font-bold">Servicios que realiza</h2>
        <p className="mb-4 text-sm text-zinc-600">Solo se podrá reservar con este profesional los servicios marcados.</p>
        <FormularioServiciosProfesional
          profesionalId={profesional.id}
          servicios={servicios}
          asignados={asignados.map((a) => a.servicio_id)}
        />
      </Tarjeta>

      <Tarjeta>
        <h2 className="text-lg font-bold">Horario semanal</h2>
        <p className="mb-4 text-sm text-zinc-600">
          Podés cargar varias franjas por día (por ejemplo, de 9 a 13 y de 16 a 20). Para vacaciones o días puntuales usá{" "}
          <Link href="/panel/bloqueos" className="font-semibold text-marca-700 hover:underline">
            Ausencias
          </Link>
          .
        </p>
        <EditorHorarios profesionalId={profesional.id} horarios={horarios} />
      </Tarjeta>

      <Tarjeta>
        <h2 className="mb-4 text-lg font-bold">Datos</h2>
        <FormularioProfesional profesional={profesional} />
      </Tarjeta>

      <EliminarProfesional id={profesional.id} />
    </div>
  );
}
