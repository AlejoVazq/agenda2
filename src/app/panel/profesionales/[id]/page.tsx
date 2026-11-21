import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Aviso, EncabezadoPagina, Tarjeta } from "@/components/ui";
import { requerirDueno } from "@/lib/auth";
import { comoUsuario, sql } from "@/lib/db";
import { formatDuracion, formatPrecio } from "@/lib/fechas";
import type { Horario, Profesional } from "@/lib/tipos";
import { EditorHorarios, EliminarProfesional, FormularioProfesional } from "../formularios";

export const metadata: Metadata = { title: "Profesional" };

export default async function PaginaProfesional({ params, searchParams }: PageProps<"/panel/profesionales/[id]">) {
  const { id } = await params;
  const { nuevo } = await searchParams;
  const { negocio, userId } = await requerirDueno();
  if (!z.uuid().safeParse(id).success) notFound();

  const [profesional, servicios, horarios] = await comoUsuario(userId, (tx) =>
    Promise.all([
      tx.uno<Profesional>(sql`select * from public.profesionales where id = ${id} and negocio_id = ${negocio.id}`),
      // Lo que hace, con su precio y su duración (los propios o los del servicio).
      tx.varios<{ id: string; nombre: string; activo: boolean; precio: number | null; duracion_min: number; propio: boolean }>(sql`
        select s.id, s.nombre, s.activo, coalesce(ps.precio, s.precio) as precio,
               coalesce(ps.duracion_min, s.duracion_min) as duracion_min,
               (ps.precio is not null or ps.duracion_min is not null) as propio
        from public.profesional_servicio ps join public.servicios s on s.id = ps.servicio_id
        where ps.profesional_id = ${id} and s.negocio_id = ${negocio.id} and not s.emergencia
        order by s.orden, s.nombre`),
      tx.varios<Horario>(sql`
        select * from public.horarios_profesional where profesional_id = ${id} order by dia_semana, desde`),
    ]),
  );
  if (!profesional) notFound();

  return (
    <div className="max-w-3xl space-y-6">
      <EncabezadoPagina titulo={profesional.nombre} volver={{ href: "/panel/profesionales", texto: "Profesionales" }} />

      {nuevo ? (
        <Aviso tipo="exito">
          Profesional creado y asignado a todos tus servicios. Cargá su horario; si no hace algún servicio, o cobra o tarda
          distinto, cambialo en cada servicio.
        </Aviso>
      ) : null}

      <Tarjeta>
        <h2 className="text-lg font-bold">Servicios que realiza</h2>
        <p className="mb-4 text-sm text-zinc-600">
          Quién hace cada servicio, y a qué precio, se elige en cada{" "}
          <Link href="/panel/servicios" className="font-semibold text-marca-700 hover:underline">
            servicio
          </Link>
          .
        </p>
        {servicios.length === 0 ? (
          <p className="text-sm text-zinc-600">Todavía no hace ningún servicio, así que no se le pueden reservar turnos.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200">
            {servicios.map((s) => (
              <li key={s.id}>
                <Link href={`/panel/servicios/${s.id}`} className="flex items-center gap-3 px-3.5 py-2.5 hover:bg-zinc-50">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {s.nombre}
                    {s.activo ? null : <span className="font-normal text-zinc-500"> · inactivo</span>}
                  </span>
                  <span className="shrink-0 text-sm text-zinc-500">
                    {formatDuracion(s.duracion_min)}
                    {s.precio !== null ? ` · ${formatPrecio(s.precio)}` : ""}
                    {s.propio ? <span className="text-marca-700"> · propio</span> : null}
                  </span>
                  <span className="text-zinc-400">›</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
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
