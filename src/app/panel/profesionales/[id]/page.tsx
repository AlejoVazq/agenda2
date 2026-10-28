import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Aviso, EncabezadoPagina, Tarjeta } from "@/components/ui";
import { requerirDueno } from "@/lib/auth";
import { crearSupabaseServidor } from "@/lib/supabase/server";
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
  const { negocio } = await requerirDueno();
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await crearSupabaseServidor();
  const [{ data: prof }, { data: servicios }, { data: asignados }, { data: horarios }] = await Promise.all([
    supabase.from("profesionales").select("*").eq("id", id).eq("negocio_id", negocio.id).maybeSingle(),
    supabase.from("servicios").select("*").eq("negocio_id", negocio.id).order("orden").order("nombre"),
    supabase.from("profesional_servicio").select("servicio_id").eq("profesional_id", id),
    supabase.from("horarios_profesional").select("*").eq("profesional_id", id).order("dia_semana").order("desde"),
  ]);
  if (!prof) notFound();
  const profesional = prof as Profesional;

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
          servicios={(servicios ?? []) as Servicio[]}
          asignados={(asignados ?? []).map((a) => a.servicio_id as string)}
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
        <EditorHorarios profesionalId={profesional.id} horarios={(horarios ?? []) as Horario[]} />
      </Tarjeta>

      <Tarjeta>
        <h2 className="mb-4 text-lg font-bold">Datos</h2>
        <FormularioProfesional profesional={profesional} />
      </Tarjeta>

      <EliminarProfesional id={profesional.id} />
    </div>
  );
}
