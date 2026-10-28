import type { Metadata } from "next";
import Link from "next/link";
import { BotonLink, EncabezadoPagina, Insignia, Vacio } from "@/components/ui";
import { requerirDueno } from "@/lib/auth";
import { crearSupabaseServidor } from "@/lib/supabase/server";
import { formatDuracion, formatPrecio } from "@/lib/fechas";
import type { Servicio } from "@/lib/tipos";

export const metadata: Metadata = { title: "Servicios" };

export default async function PaginaServicios() {
  const { negocio } = await requerirDueno();
  const supabase = await crearSupabaseServidor();
  const [{ data: servicios }, { data: asignaciones }] = await Promise.all([
    supabase.from("servicios").select("*").eq("negocio_id", negocio.id).order("orden").order("nombre"),
    supabase.from("profesional_servicio").select("servicio_id").eq("negocio_id", negocio.id),
  ]);
  const lista = (servicios ?? []) as Servicio[];
  const conProfesional = new Set((asignaciones ?? []).map((a) => a.servicio_id as string));

  return (
    <>
      <EncabezadoPagina
        titulo="Servicios"
        descripcion="Lo que tus clientes pueden reservar."
        acciones={<BotonLink href="/panel/servicios/nuevo">+ Nuevo servicio</BotonLink>}
      />
      {lista.length === 0 ? (
        <Vacio
          titulo="Todavía no cargaste servicios"
          descripcion="Agregá cada servicio con su duración, así calculamos los horarios disponibles."
          accion={<BotonLink href="/panel/servicios/nuevo">Crear el primero</BotonLink>}
        />
      ) : (
        <ul className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
          {lista.map((s) => (
            <li key={s.id}>
              <Link href={`/panel/servicios/${s.id}`} className="flex items-center gap-3 px-4 py-3.5 hover:bg-zinc-50">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{s.nombre}</p>
                  <p className="text-sm text-zinc-500">
                    {formatDuracion(s.duracion_min)}
                    {s.precio !== null ? ` · ${formatPrecio(s.precio)}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {!s.activo ? <Insignia>Inactivo</Insignia> : null}
                  {s.activo && !conProfesional.has(s.id) ? <Insignia color="ambar">Sin profesional</Insignia> : null}
                </div>
                <span className="text-zinc-400">›</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
