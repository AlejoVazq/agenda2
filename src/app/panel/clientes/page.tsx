import type { Metadata } from "next";
import { EncabezadoPagina, Input, Vacio, clasesBoton } from "@/components/ui";
import { requerirDueno } from "@/lib/auth";
import { crearSupabaseServidor } from "@/lib/supabase/server";
import { formatFechaCorta } from "@/lib/fechas";
import { linkWhatsApp } from "@/lib/whatsapp";
import type { Cliente } from "@/lib/tipos";

export const metadata: Metadata = { title: "Clientes" };

export default async function PaginaClientes({ searchParams }: PageProps<"/panel/clientes">) {
  const { q } = await searchParams;
  const { negocio } = await requerirDueno();
  const busqueda = typeof q === "string" ? q.trim().slice(0, 60) : "";

  const supabase = await crearSupabaseServidor();
  let consulta = supabase
    .from("clientes")
    .select("id, nombre, telefono, email, notas, created_at, turnos(inicio, estado)")
    .eq("negocio_id", negocio.id)
    .order("nombre")
    .limit(200);
  if (busqueda) {
    // Escapar comodines de LIKE y caracteres especiales del filtro de PostgREST.
    const seguro = busqueda.replace(/[%_\\,().*]/g, " ");
    const digitos = busqueda.replace(/\D/g, "");
    consulta = digitos.length >= 3
      ? consulta.or(`nombre.ilike.%${seguro}%,telefono.ilike.%${digitos}%`)
      : consulta.ilike("nombre", `%${seguro}%`);
  }
  const { data } = await consulta;
  const clientes = (data ?? []) as (Cliente & { turnos: { inicio: string; estado: string }[] })[];
  const ahora = new Date().toISOString();

  return (
    <>
      <EncabezadoPagina titulo="Clientes" descripcion="Se crean solos cuando alguien reserva o cuando agendás un turno." />
      <form className="mb-5 flex gap-2">
        <Input name="q" defaultValue={busqueda} placeholder="Buscar por nombre o celular" aria-label="Buscar" />
        <button className={clasesBoton("secundario")}>Buscar</button>
      </form>
      {clientes.length === 0 ? (
        <Vacio titulo={busqueda ? "Sin resultados" : "Todavía no hay clientes"} />
      ) : (
        <ul className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
          {clientes.map((c) => {
            const activos = c.turnos.filter((t) => t.estado !== "cancelado");
            const proximo = activos.filter((t) => t.inicio >= ahora).sort((a, b) => a.inicio.localeCompare(b.inicio))[0];
            const ultimo = activos.filter((t) => t.inicio < ahora).sort((a, b) => b.inicio.localeCompare(a.inicio))[0];
            return (
              <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{c.nombre}</p>
                  <p className="truncate text-sm text-zinc-500">
                    {activos.length} {activos.length === 1 ? "turno" : "turnos"}
                    {proximo ? ` · próximo ${formatFechaCorta(proximo.inicio, negocio.zona_horaria)}` : ""}
                    {!proximo && ultimo ? ` · último ${formatFechaCorta(ultimo.inicio, negocio.zona_horaria)}` : ""}
                  </p>
                </div>
                <a
                  href={linkWhatsApp(c.telefono)}
                  target="_blank"
                  className="shrink-0 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
                >
                  WhatsApp
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
