import type { Metadata } from "next";
import { Aviso, EncabezadoPagina } from "@/components/ui";
import { requerirPanel } from "@/lib/auth";
import { crearSupabaseServidor } from "@/lib/supabase/server";
import type { Profesional, Servicio } from "@/lib/tipos";
import { Agenda } from "./agenda";

export const metadata: Metadata = { title: "Agenda" };

export default async function PaginaAgenda({ searchParams }: PageProps<"/panel/agenda">) {
  const { nuevo } = await searchParams;
  const { negocio, perfil, esDueno } = await requerirPanel();
  const supabase = await crearSupabaseServidor();

  const [{ data: profs }, { data: servs }, { data: asign }] = await Promise.all([
    supabase.from("profesionales").select("id, nombre, color").eq("negocio_id", negocio.id).eq("activo", true).order("orden").order("nombre"),
    supabase.from("servicios").select("id, nombre, duracion_min").eq("negocio_id", negocio.id).eq("activo", true).order("orden").order("nombre"),
    supabase.from("profesional_servicio").select("profesional_id, servicio_id").eq("negocio_id", negocio.id),
  ]);

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
          profesionales={(profs ?? []) as Pick<Profesional, "id" | "nombre" | "color">[]}
          servicios={(servs ?? []) as Pick<Servicio, "id" | "nombre" | "duracion_min">[]}
          asignaciones={(asign ?? []) as { profesional_id: string; servicio_id: string }[]}
          abrirNuevo={nuevo === "1"}
          nombreNegocio={negocio.nombre}
        />
      )}
    </>
  );
}
