import type { Metadata } from "next";
import { Aviso, EncabezadoPagina, Insignia, Tarjeta } from "@/components/ui";
import { requerirDueno } from "@/lib/auth";
import { crearSupabaseServidor } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import type { Perfil, Profesional } from "@/lib/tipos";
import { AccionesEmpleado, FormularioInvitacion } from "./formularios";

export const metadata: Metadata = { title: "Accesos del equipo" };

export default async function PaginaEquipo() {
  const { negocio, perfil: yo } = await requerirDueno();
  const supabase = await crearSupabaseServidor();
  const [{ data: perfiles }, { data: profs }] = await Promise.all([
    supabase.from("perfiles").select("id, negocio_id, rol, nombre, profesional_id").eq("negocio_id", negocio.id).order("rol"),
    supabase.from("profesionales").select("id, nombre").eq("negocio_id", negocio.id).eq("activo", true).order("nombre"),
  ]);
  const usuarios = (perfiles ?? []) as Perfil[];
  const profesionales = (profs ?? []) as Pick<Profesional, "id" | "nombre">[];
  const nombreProf = new Map(profesionales.map((p) => [p.id, p.nombre]));
  const vinculados = new Set(usuarios.map((u) => u.profesional_id).filter(Boolean));
  const libres = profesionales.filter((p) => !vinculados.has(p.id));
  const adminConfigurado = Boolean(env.supabaseServiceRoleKey);

  return (
    <div className="max-w-3xl space-y-6">
      <EncabezadoPagina
        titulo="Accesos del equipo"
        descripcion="Dale acceso al panel a quienes trabajan con vos. Cada empleado ve solo su propia agenda."
      />

      <ul className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
        {usuarios.map((u) => (
          <li key={u.id} className="space-y-3 px-4 py-3.5">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">
                  {u.nombre} {u.id === yo.id ? <span className="font-normal text-zinc-500">(vos)</span> : null}
                </p>
                <p className="truncate text-sm text-zinc-500">
                  {u.profesional_id ? `Agenda: ${nombreProf.get(u.profesional_id) ?? "—"}` : "Sin agenda propia"}
                </p>
              </div>
              <Insignia color={u.rol === "dueno" ? "violeta" : "gris"}>{u.rol === "dueno" ? "Dueño/a" : "Empleado/a"}</Insignia>
            </div>
            {u.rol === "empleado" && adminConfigurado ? <AccionesEmpleado perfilId={u.id} /> : null}
          </li>
        ))}
      </ul>

      <Tarjeta>
        <h2 className="mb-1 text-lg font-bold">Invitar a alguien del equipo</h2>
        <p className="mb-4 text-sm text-zinc-600">
          Primero creá a la persona en Profesionales; después generá su invitación acá.
        </p>
        {!adminConfigurado ? (
          <Aviso tipo="alerta">Las invitaciones todavía no están disponibles.</Aviso>
        ) : libres.length === 0 ? (
          <Aviso tipo="info">Todos los profesionales activos ya tienen usuario. Creá uno nuevo en Profesionales.</Aviso>
        ) : (
          <FormularioInvitacion profesionales={libres} />
        )}
      </Tarjeta>
    </div>
  );
}
