import type { Metadata } from "next";
import Link from "next/link";
import { cx, EncabezadoPagina, Vacio } from "@/components/ui";
import { requerirDueno } from "@/lib/auth";
import { comoUsuario, sql } from "@/lib/db";
import { formatFechaCorta, formatHora, formatPrecio } from "@/lib/fechas";
import { MEDIOS_PEDIDO, type EstadoPedido, type MedioPago } from "@/lib/tipos";
import { InsigniaPedido } from "./insignia";

export const metadata: Metadata = { title: "Pedidos" };

const PESTANAS = {
  pendientes: "Pendientes",
  "por-entregar": "Por entregar",
  historial: "Historial",
} as const;
type Pestana = keyof typeof PESTANAS;

const POR_PAGINA = 50;

type Fila = {
  id: string;
  numero: number;
  nombre: string | null;
  email: string;
  medio: MedioPago;
  estado: EstadoPedido;
  total: number;
  vence_at: string | null;
  created_at: string;
  pagado_at: string | null;
  entregado_at: string | null;
  cancelado_at: string | null;
  /** Pendiente con el plazo cumplido que el cron todavía no liberó. */
  vencio: boolean;
};

export default async function PaginaPedidos({ searchParams }: PageProps<"/panel/pedidos">) {
  const sp = await searchParams;
  const { negocio, userId } = await requerirDueno();
  const tz = negocio.zona_horaria;
  const ver: Pestana = typeof sp.ver === "string" && Object.hasOwn(PESTANAS, sp.ver) ? (sp.ver as Pestana) : "pendientes";
  const pedida = Number(sp.pagina);
  const pagina = ver === "historial" && Number.isInteger(pedida) && pedida >= 1 ? pedida : 1;

  const filtro = {
    pendientes: sql`estado in ('pendiente', 'reembolsar')`,
    "por-entregar": sql`estado = 'pagado'`,
    historial: sql`estado in ('entregado', 'cancelado', 'vencido')`,
  }[ver];
  // Pendientes: los que vencen antes, primero (y los "a devolver" arriba). Historial: lo último primero.
  const orden =
    ver === "historial"
      ? sql`coalesce(entregado_at, cancelado_at, vence_at, created_at) desc, numero desc`
      : ver === "pendientes"
        ? sql`(estado = 'reembolsar') desc, vence_at nulls first, numero`
        : sql`pagado_at, numero`;

  const [filas, cuentas] = await comoUsuario(userId, (tx) =>
    Promise.all([
      tx.varios<Fila>(sql`
        select id, numero, nombre, email, medio, estado, total, vence_at, created_at, pagado_at, entregado_at, cancelado_at,
               coalesce(vence_at < now(), false) as vencio
        from public.pedidos
        where negocio_id = ${negocio.id} and ${filtro}
        order by ${orden}
        limit ${POR_PAGINA + 1} offset ${(pagina - 1) * POR_PAGINA}`),
      tx.uno<{ pendientes: number; por_entregar: number }>(sql`
        select count(*) filter (where estado in ('pendiente', 'reembolsar'))::int as pendientes,
               count(*) filter (where estado = 'pagado')::int as por_entregar
        from public.pedidos where negocio_id = ${negocio.id}`),
    ]),
  );
  const hayMas = filas.length > POR_PAGINA;
  const lista = filas.slice(0, POR_PAGINA);
  const cantidad: Partial<Record<Pestana, number>> = {
    pendientes: cuentas?.pendientes ?? 0,
    "por-entregar": cuentas?.por_entregar ?? 0,
  };

  function cuando(p: Fila) {
    const fecha = (iso: string) => `${formatFechaCorta(iso, tz)} ${formatHora(iso, tz)} h`;
    if (p.estado === "pendiente" && p.vence_at) {
      return p.vencio ? "Venció, se libera en breve" : `Vence ${fecha(p.vence_at)}`;
    }
    if (p.estado === "pagado" && p.pagado_at) return `Pagado ${fecha(p.pagado_at)}`;
    if (p.estado === "entregado" && p.entregado_at) return `Entregado ${fecha(p.entregado_at)}`;
    if (p.estado === "cancelado" && p.cancelado_at) return `Cancelado ${fecha(p.cancelado_at)}`;
    if (p.estado === "vencido" && p.vence_at) return `Venció ${fecha(p.vence_at)}`;
    if (p.estado === "reembolsar") return "Pagó pero no quedó stock: devolvele la plata";
    return `Pedido ${fecha(p.created_at)}`;
  }

  return (
    <>
      <EncabezadoPagina titulo="Pedidos" descripcion="Lo que te piden desde tu página para retirar en el local." />

      <nav className="mb-5 flex gap-1 overflow-x-auto rounded-2xl bg-zinc-100 p-1" aria-label="Pedidos">
        {(Object.keys(PESTANAS) as Pestana[]).map((p) => (
          <Link
            key={p}
            href={p === "pendientes" ? "/panel/pedidos" : `/panel/pedidos?ver=${p}`}
            aria-current={p === ver ? "page" : undefined}
            className={cx(
              "flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-semibold",
              p === ver ? "bg-white text-tinta shadow-suave" : "text-zinc-600 hover:text-tinta",
            )}
          >
            {PESTANAS[p]}
            {cantidad[p] ? (
              <span className="rounded-full bg-marca-100 px-1.5 text-xs font-bold text-marca-800 tabular-nums">{cantidad[p]}</span>
            ) : null}
          </Link>
        ))}
      </nav>

      {lista.length === 0 ? (
        <Vacio
          titulo={
            ver === "pendientes"
              ? "No hay pedidos pendientes"
              : ver === "por-entregar"
                ? "No hay pedidos para entregar"
                : "Todavía no hay pedidos terminados"
          }
          descripcion={
            ver === "pendientes"
              ? "Cuando un cliente haga un pedido desde tu página, aparece acá hasta que lo pague."
              : undefined
          }
        />
      ) : (
        <ul className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
          {lista.map((p) => (
            <li key={p.id}>
              <Link href={`/panel/pedidos/${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-50">
                <span className="w-12 shrink-0 font-bold tabular-nums text-zinc-500">#{p.numero}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{p.nombre ?? p.email}</p>
                  <p className="truncate text-sm text-zinc-500">
                    {MEDIOS_PEDIDO[p.medio]} · {cuando(p)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="font-semibold tabular-nums">{formatPrecio(p.total)}</span>
                  <InsigniaPedido estado={p.estado} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {ver === "historial" && (pagina > 1 || hayMas) ? (
        <div className="mt-4 flex justify-between text-sm font-semibold">
          {pagina > 1 ? (
            <Link
              href={pagina === 2 ? "/panel/pedidos?ver=historial" : `/panel/pedidos?ver=historial&pagina=${pagina - 1}`}
              className="rounded-xl px-3 py-2 text-marca-800 hover:bg-white"
            >
              ← Más nuevos
            </Link>
          ) : (
            <span />
          )}
          {hayMas ? (
            <Link href={`/panel/pedidos?ver=historial&pagina=${pagina + 1}`} className="rounded-xl px-3 py-2 text-marca-800 hover:bg-white">
              Más viejos →
            </Link>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
