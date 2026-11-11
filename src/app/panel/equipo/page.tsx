import type { Metadata } from "next";
import { EncabezadoPagina, Insignia, Tarjeta } from "@/components/ui";
import { requerirDueno } from "@/lib/auth";
import { comoUsuario, sql } from "@/lib/db";
import type { Perfil, Profesional } from "@/lib/tipos";
import { AccionesEmpleado, FormularioInvitacion } from "./formularios";

export const metadata: Metadata = { title: "Accesos del equipo" };

export default async function PaginaEquipo() {
  const { negocio, perfil: yo, userId } = await requerirDueno();
  const [usuarios, profesionales] = await comoUsuario(userId, (tx) =>
    Promise.all([
      tx.varios<Perfil>(sql`
        select id, negocio_id, rol, nombre, profesional_id from public.perfiles
        where negocio_id = ${negocio.id} order by rol, nombre`),
      tx.varios<Pick<Profesional, "id" | "nombre">>(sql`
        select id, nombre from public.profesionales
        where negocio_id = ${negocio.id} and activo order by nombre`),
    ]),
  );
  const nombreProf = new Map(profesionales.map((p) => [p.id, p.nombre]));
  const vinculados = new Set(usuarios.map((u) => u.profesional_id).filter(Boolean));
  const libres = profesionales.filter((p) => !vinculados.has(p.id));

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
            {u.rol === "empleado" ? <AccionesEmpleado perfilId={u.id} /> : null}
          </li>
        ))}
      </ul>

      <Tarjeta>
        <h2 className="mb-1 text-lg font-bold">Invitar a alguien del equipo</h2>
        <p className="mb-4 text-sm text-zinc-600">
          Primero creá a la persona en Profesionales; después generá su invitación acá.
        </p>
        <FormularioInvitacion profesionales={libres} />
      </Tarjeta>
    </div>
  );
}
