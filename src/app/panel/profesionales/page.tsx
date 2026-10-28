import type { Metadata } from "next";
import Link from "next/link";
import { BotonLink, EncabezadoPagina, Insignia, Vacio } from "@/components/ui";
import { requerirDueno } from "@/lib/auth";
import { crearSupabaseServidor } from "@/lib/supabase/server";
import { DIAS_SEMANA, type Profesional } from "@/lib/tipos";

export const metadata: Metadata = { title: "Profesionales" };

export default async function PaginaProfesionales() {
  const { negocio } = await requerirDueno();
  const supabase = await crearSupabaseServidor();
  const [{ data: profesionales }, { data: horarios }, { data: asignaciones }] = await Promise.all([
    supabase.from("profesionales").select("*").eq("negocio_id", negocio.id).order("orden").order("nombre"),
    supabase.from("horarios_profesional").select("profesional_id, dia_semana").eq("negocio_id", negocio.id),
    supabase.from("profesional_servicio").select("profesional_id").eq("negocio_id", negocio.id),
  ]);
  const lista = (profesionales ?? []) as Profesional[];

  const diasPorProf = new Map<string, Set<number>>();
  for (const h of horarios ?? []) {
    if (!diasPorProf.has(h.profesional_id)) diasPorProf.set(h.profesional_id, new Set());
    diasPorProf.get(h.profesional_id)!.add(h.dia_semana);
  }
  const serviciosPorProf = new Map<string, number>();
  for (const a of asignaciones ?? []) serviciosPorProf.set(a.profesional_id, (serviciosPorProf.get(a.profesional_id) ?? 0) + 1);

  return (
    <>
      <EncabezadoPagina
        titulo="Profesionales"
        descripcion="Las personas que atienden, qué servicios hacen y en qué horarios."
        acciones={<BotonLink href="/panel/profesionales/nuevo">+ Nuevo profesional</BotonLink>}
      />
      {lista.length === 0 ? (
        <Vacio
          titulo="Todavía no hay profesionales"
          descripcion="Agregá a cada persona que atiende para que puedan recibir turnos."
          accion={<BotonLink href="/panel/profesionales/nuevo">Agregar profesional</BotonLink>}
        />
      ) : (
        <ul className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
          {lista.map((p) => {
            const dias = [...(diasPorProf.get(p.id) ?? [])].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
            const cantServicios = serviciosPorProf.get(p.id) ?? 0;
            return (
              <li key={p.id}>
                <Link href={`/panel/profesionales/${p.id}`} className="flex items-center gap-3 px-4 py-3.5 hover:bg-zinc-50">
                  <span
                    className="grid size-10 shrink-0 place-items-center rounded-full text-sm font-bold text-white"
                    style={{ background: p.color }}
                  >
                    {p.nombre.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{p.nombre}</p>
                    <p className="truncate text-sm text-zinc-500">
                      {dias.length ? dias.map((d) => DIAS_SEMANA[d].slice(0, 3)).join(" · ") : "Sin horarios"}
                      {" · "}
                      {cantServicios} {cantServicios === 1 ? "servicio" : "servicios"}
                    </p>
                  </div>
                  {!p.activo ? <Insignia>Inactivo</Insignia> : null}
                  {p.activo && (dias.length === 0 || cantServicios === 0) ? (
                    <Insignia color="ambar">Incompleto</Insignia>
                  ) : null}
                  <span className="text-zinc-400">›</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
