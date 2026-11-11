import type { Metadata } from "next";
import Link from "next/link";
import { EncabezadoPagina, Input, Vacio, clasesBoton } from "@/components/ui";
import { requerirDueno } from "@/lib/auth";
import { comoUsuario, sql } from "@/lib/db";
import { formatFechaCorta } from "@/lib/fechas";
import { linkWhatsApp } from "@/lib/whatsapp";
import type { Cliente } from "@/lib/tipos";

export const metadata: Metadata = { title: "Clientes" };

export default async function PaginaClientes({ searchParams }: PageProps<"/panel/clientes">) {
  const { q } = await searchParams;
  const { negocio, userId } = await requerirDueno();
  const busqueda = typeof q === "string" ? q.trim().slice(0, 60) : "";

  // Escapar los comodines de LIKE: lo que escribe el usuario se busca tal cual.
  const seguro = busqueda.replace(/[\\%_]/g, (c) => `\\${c}`);
  const digitos = busqueda.replace(/\D/g, "");
  const filtro = !busqueda
    ? sql``
    : digitos.length >= 3
      ? sql`and (c.nombre ilike ${`%${seguro}%`} or c.telefono like ${`%${digitos}%`})`
      : sql`and c.nombre ilike ${`%${seguro}%`}`;

  const clientes = await comoUsuario(userId, (tx) =>
    tx.varios<Cliente & { turnos: { inicio: string; estado: string }[] }>(sql`
      select c.id, c.nombre, c.telefono, c.email, c.notas, c.created_at,
             coalesce(
               (select json_agg(json_build_object('inicio', t.inicio, 'estado', t.estado)) from public.turnos t where t.cliente_id = c.id),
               '[]'::json
             ) as turnos
      from public.clientes c
      where c.negocio_id = ${negocio.id} ${filtro}
      order by c.nombre
      limit 200`),
  );
  const ahora = new Date().toISOString();

  return (
    <>
      <EncabezadoPagina
        titulo="Clientes"
        descripcion="Se crean solos cuando alguien reserva o cuando agendás un turno."
        acciones={
          <a href="/panel/clientes/exportar" className={clasesBoton("secundario", "sm")} download>
            Exportar CSV
          </a>
        }
      />
      <form className="mb-5 flex gap-2">
        <Input name="q" defaultValue={busqueda} placeholder="Buscar por nombre o celular" aria-label="Buscar" />
        <button className={clasesBoton("secundario")}>Buscar</button>
      </form>
      {clientes.length === 0 ? (
        <Vacio titulo={busqueda ? "Sin resultados" : "Todavía no hay clientes"} />
      ) : (
        <ul className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
          {clientes.map((c) => {
            const activos = c.turnos.filter((t) => t.estado !== "cancelado" && t.estado !== "ausente");
            const proximo = activos.filter((t) => t.inicio >= ahora).sort((a, b) => a.inicio.localeCompare(b.inicio))[0];
            const ultimo = activos.filter((t) => t.inicio < ahora).sort((a, b) => b.inicio.localeCompare(a.inicio))[0];
            return (
              <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                <Link href={`/panel/clientes/${c.id}`} className="min-w-0 flex-1 rounded-lg hover:text-marca-800">
                  <p className="truncate font-semibold">{c.nombre}</p>
                  <p className="truncate text-sm text-zinc-500">
                    {activos.length} {activos.length === 1 ? "turno" : "turnos"}
                    {proximo ? ` · próximo ${formatFechaCorta(proximo.inicio, negocio.zona_horaria)}` : ""}
                    {!proximo && ultimo ? ` · último ${formatFechaCorta(ultimo.inicio, negocio.zona_horaria)}` : ""}
                  </p>
                </Link>
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
