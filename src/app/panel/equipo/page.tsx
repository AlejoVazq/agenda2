import type { Metadata } from "next";
import { AvatarProfesional } from "@/components/avatar-profesional";
import { EncabezadoPagina, Insignia, Tarjeta } from "@/components/ui";
import { requerirDueno } from "@/lib/auth";
import { comoUsuario, sql } from "@/lib/db";
import { urlFoto, versionesFotos } from "@/lib/foto-profesional";
import type { Perfil, Profesional } from "@/lib/tipos";
import { AccionesEmpleado, FormularioInvitacion } from "./formularios";

export const metadata: Metadata = { title: "Accesos del equipo" };

export default async function PaginaEquipo() {
  const { negocio, perfil: yo, userId } = await requerirDueno();
  const [usuarios, profesionales] = await comoUsuario(userId, (tx) =>
    Promise.all([
      tx.varios<Perfil>(sql`
        select id, negocio_id, rol, nombre, profesional_id from public.perfiles
        where negocio_id = ${negocio.id} order by rol, created_at, id`),
      tx.varios<Pick<Profesional, "id" | "nombre" | "color">>(sql`
        select id, nombre, color from public.profesionales
        where negocio_id = ${negocio.id} and activo order by nombre`),
    ]),
  );
  const nombreProf = new Map(profesionales.map((p) => [p.id, p.nombre]));
  const colorProf = new Map(profesionales.map((p) => [p.id, p.color]));
  const fotos = await versionesFotos(negocio.id);
  const vinculados = new Set(usuarios.map((u) => u.profesional_id).filter(Boolean));
  const libres = profesionales.filter((p) => !vinculados.has(p.id));
  // Quien creó el negocio (el primer dueño): es el único que puede quitar a un socio.
  const titular = usuarios.find((u) => u.rol === "dueno")?.id;

  return (
    <div className="max-w-3xl space-y-6">
      <EncabezadoPagina
        titulo="Accesos del equipo"
        descripcion="Dale acceso al panel a quienes trabajan con vos. Cada empleado ve solo su propia agenda; un socio maneja todo el negocio."
      />

      <ul className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
        {usuarios.map((u) => (
          <li key={u.id} className="space-y-3 px-4 py-3.5">
            <div className="flex items-center gap-3">
              <AvatarProfesional
                nombre={u.nombre}
                color={(u.profesional_id && colorProf.get(u.profesional_id)) || "#7c8a83"}
                foto={u.profesional_id ? urlFoto(u.profesional_id, fotos.get(u.profesional_id)) : null}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">
                  {u.nombre} {u.id === yo.id ? <span className="font-normal text-zinc-500">(vos)</span> : null}
                </p>
                <p className="truncate text-sm text-zinc-500">
                  {u.profesional_id ? `Agenda: ${nombreProf.get(u.profesional_id) ?? "—"}` : "Sin agenda propia"}
                </p>
              </div>
              <Insignia color={u.rol === "dueno" ? "violeta" : "gris"}>
                {u.rol === "empleado" ? "Empleado/a" : u.id === titular ? "Dueño/a" : "Socio/a"}
              </Insignia>
            </div>
            {u.id === yo.id || u.id === titular ? null : (
              <AccionesEmpleado perfilId={u.id} puedeQuitar={u.rol === "empleado" || yo.id === titular} />
            )}
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
