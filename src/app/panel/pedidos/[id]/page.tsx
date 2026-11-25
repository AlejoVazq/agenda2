import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { BotonAccion } from "@/components/boton-accion";
import { Aviso, EncabezadoPagina, Insignia, Tarjeta } from "@/components/ui";
import { requerirDueno } from "@/lib/auth";
import { comoUsuario, sql } from "@/lib/db";
import { env } from "@/lib/env";
import { formatFechaHora, formatPrecio } from "@/lib/fechas";
import { MEDIOS_PEDIDO, type EstadoPedido, type MedioPago } from "@/lib/tipos";
import { linkWhatsApp } from "@/lib/whatsapp";
import { cancelarPedido, marcarPedidoDevuelto, marcarPedidoEntregado, marcarPedidoPagado } from "../acciones";
import { InsigniaPedido } from "../insignia";

export const metadata: Metadata = { title: "Pedido" };

type Pedido = {
  id: string;
  numero: number;
  token: string;
  nombre: string | null;
  email: string;
  telefono: string | null;
  medio: MedioPago;
  estado: EstadoPedido;
  total: number;
  vence_at: string | null;
  pago_id: string | null;
  created_at: string;
  pagado_at: string | null;
  entregado_at: string | null;
  cancelado_at: string | null;
  cancelado_por: "cliente" | "negocio" | "sistema" | null;
  turno_id: string | null;
};

type Item = { id: string; nombre: string; precio_unitario: number; cantidad: number };

export default async function PaginaPedido({ params }: PageProps<"/panel/pedidos/[id]">) {
  const { id } = await params;
  const { negocio, userId } = await requerirDueno();
  if (!z.uuid().safeParse(id).success) notFound();

  const [p, items] = await comoUsuario(userId, (tx) =>
    Promise.all([
      tx.uno<Pedido>(sql`
        select id, numero, token, nombre, email, telefono, medio, estado, total, vence_at, pago_id, created_at,
               pagado_at, entregado_at, cancelado_at, cancelado_por, turno_id
        from public.pedidos where id = ${id} and negocio_id = ${negocio.id}`),
      tx.varios<Item>(sql`
        select id, nombre, precio_unitario, cantidad from public.pedido_items
        where pedido_id = ${id} order by nombre, id`),
    ]),
  );
  if (!p) notFound();
  // El turno se lee con RLS: si es de una agenda que no ve (socio), no se muestra.
  const turno = p.turno_id
    ? await comoUsuario(userId, (tx) =>
        tx.uno<{ id: string; inicio: string; estado: string }>(sql`
          select id, inicio, estado from public.turnos where id = ${p.turno_id}`),
      )
    : null;

  const tz = negocio.zona_horaria;
  const cliente = p.nombre ?? p.email;
  const nombre = p.nombre?.split(" ")[0] ?? "";
  const linkCliente = `${env.siteUrl}/p/${p.token}`;
  const fecha = (iso: string) => formatFechaHora(iso, tz);
  const vencioSinLiberar = p.estado === "pendiente" && p.vence_at !== null && new Date(p.vence_at) < new Date();

  const mensajes = p.telefono
    ? p.estado === "pendiente"
      ? [
          p.medio === "transferencia"
            ? {
                titulo: "Recordar la transferencia",
                texto: `Hola ${nombre}! Te escribo de ${negocio.nombre} por tu pedido #${p.numero} (${formatPrecio(p.total)}). Todavía no vimos la transferencia; los datos están acá: ${linkCliente}`,
              }
            : {
                titulo: "Recordar el pedido",
                texto: `Hola ${nombre}! Te recuerdo que tu pedido #${p.numero} (${formatPrecio(p.total)}) te espera en ${negocio.nombre}${negocio.direccion ? ` (${negocio.direccion})` : ""}. Lo ves acá: ${linkCliente}`,
              },
          { titulo: "Escribirle", texto: `Hola ${nombre}! Te escribo de ${negocio.nombre} por tu pedido #${p.numero}. ` },
        ]
      : p.estado === "pagado"
        ? [
            {
              titulo: "Avisar que está listo",
              texto: `Hola ${nombre}! Tu pedido #${p.numero} ya está listo para retirar en ${negocio.nombre}${negocio.direccion ? ` (${negocio.direccion})` : ""}.`,
            },
            { titulo: "Escribirle", texto: `Hola ${nombre}! Te escribo de ${negocio.nombre} por tu pedido #${p.numero}. ` },
          ]
        : [{ titulo: "Escribirle", texto: `Hola ${nombre}! Te escribo de ${negocio.nombre} por tu pedido #${p.numero}. ` }]
    : [];

  return (
    <div className="max-w-2xl space-y-6">
      <EncabezadoPagina
        titulo={`Pedido #${p.numero}`}
        descripcion={
          <span className="inline-block first-letter:uppercase">
            {cliente} · {fecha(p.created_at)}
          </span>
        }
        volver={{ href: "/panel/pedidos", texto: "Pedidos" }}
      />

      <Tarjeta className="space-y-5">
        <div className="flex flex-wrap gap-2">
          <InsigniaPedido estado={p.estado} />
          <Insignia color="gris">{MEDIOS_PEDIDO[p.medio]}</Insignia>
          {p.estado === "cancelado" && p.cancelado_por ? (
            <Insignia>
              {p.cancelado_por === "cliente" ? "Canceló el cliente" : p.cancelado_por === "sistema" ? "Se canceló solo" : "Canceló el negocio"}
            </Insignia>
          ) : null}
        </div>

        <table className="w-full text-sm">
          <tbody className="divide-y divide-zinc-100">
            {items.map((i) => (
              <tr key={i.id}>
                <td className="py-2 pr-3">
                  <span className="font-semibold tabular-nums">{i.cantidad} ×</span> {i.nombre}
                  <span className="block text-xs text-zinc-500">{formatPrecio(i.precio_unitario)} c/u</span>
                </td>
                <td className="py-2 text-right font-medium whitespace-nowrap tabular-nums">
                  {formatPrecio(i.precio_unitario * i.cantidad)}
                </td>
              </tr>
            ))}
            <tr>
              <td className="py-2 font-bold">Total</td>
              <td className="py-2 text-right font-bold whitespace-nowrap tabular-nums">{formatPrecio(p.total)}</td>
            </tr>
          </tbody>
        </table>

        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <Dato titulo="Cliente">{cliente}</Dato>
          <Dato titulo="Celular">
            {p.telefono ? (
              <a href={linkWhatsApp(p.telefono)} target="_blank" className="text-marca-700 hover:underline">
                {p.telefono}
              </a>
            ) : (
              "—"
            )}
          </Dato>
          <Dato titulo="Email">
            <a href={`mailto:${p.email}`} className="break-all text-marca-700 hover:underline">
              {p.email}
            </a>
          </Dato>
          <Dato titulo="Pago">{MEDIOS_PEDIDO[p.medio]}</Dato>
          {p.estado === "pendiente" && p.vence_at ? <Dato titulo="Vence">{fecha(p.vence_at)}</Dato> : null}
          {p.pagado_at ? <Dato titulo="Pagado">{fecha(p.pagado_at)}</Dato> : null}
          {p.entregado_at ? <Dato titulo="Entregado">{fecha(p.entregado_at)}</Dato> : null}
          {p.cancelado_at && p.estado !== "entregado" ? <Dato titulo="Cancelado">{fecha(p.cancelado_at)}</Dato> : null}
          {p.pago_id ? <Dato titulo="Pago de Mercado Pago">{p.pago_id}</Dato> : null}
          {turno ? (
            <Dato titulo="Retira con su turno">
              <Link href={`/panel/turnos/${turno.id}`} className="text-marca-700 hover:underline">
                {fecha(turno.inicio)}
                {turno.estado === "cancelado" ? " (cancelado)" : ""}
              </Link>
            </Dato>
          ) : null}
        </dl>

        {vencioSinLiberar ? (
          <Aviso tipo="alerta">Se venció el plazo para pagar: en breve se cancela solo y el stock vuelve.</Aviso>
        ) : null}
        {p.estado === "reembolsar" ? (
          <Aviso tipo="alerta">
            <p>
              El cliente pagó {formatPrecio(p.total)} con Mercado Pago, pero el pedido ya no estaba vigente y no quedó stock.
              Devolvele la plata desde Mercado Pago (Actividad → el pago → Devolver).
            </p>
            <BotonAccion className="mt-2" accion={marcarPedidoDevuelto.bind(null, p.id)} confirmar="Sí, ya la devolví" pendiente="Guardando…">
              Marcar como devuelto
            </BotonAccion>
          </Aviso>
        ) : null}
        {p.estado === "vencido" ? (
          <Aviso tipo="info">
            <p>Si el cliente igual te pagó, podés reactivarlo (vuelve a apartar el stock, si hay).</p>
            <BotonAccion className="mt-2" accion={marcarPedidoPagado.bind(null, p.id)} confirmar="Sí, me pagó" pendiente="Guardando…">
              Me pagó igual
            </BotonAccion>
          </Aviso>
        ) : null}

        {p.estado === "pendiente" || p.estado === "pagado" ? (
          <div className="flex flex-wrap items-start gap-2 border-t border-zinc-100 pt-4">
            {p.estado === "pendiente" ? (
              <BotonAccion
                accion={marcarPedidoPagado.bind(null, p.id)}
                variante="primario"
                confirmar="Sí, ya me pagó"
                pendiente="Guardando…"
              >
                Pago recibido
              </BotonAccion>
            ) : null}
            <BotonAccion
              accion={marcarPedidoEntregado.bind(null, p.id)}
              variante={p.estado === "pagado" ? "primario" : "secundario"}
              confirmar={p.estado === "pagado" ? "Sí, lo retiró" : "Sí, lo retiró y pagó"}
              pendiente="Guardando…"
            >
              Entregado
            </BotonAccion>
            <BotonAccion
              accion={cancelarPedido.bind(null, p.id)}
              variante="peligro"
              confirmar={p.estado === "pagado" ? "Sí, cancelar (le devuelvo la plata)" : "Sí, cancelar el pedido"}
              pendiente="Cancelando…"
            >
              Cancelar pedido
            </BotonAccion>
          </div>
        ) : null}
      </Tarjeta>

      {mensajes.length && p.telefono ? (
        <Tarjeta>
          <h2 className="mb-1 font-bold">Escribirle por WhatsApp</h2>
          <p className="mb-3 text-sm text-zinc-600">Abre WhatsApp con el mensaje listo para enviar.</p>
          <div className="flex flex-wrap gap-2">
            {mensajes.map((m) => (
              <a
                key={m.titulo}
                href={linkWhatsApp(p.telefono!, m.texto)}
                target="_blank"
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
              >
                {m.titulo}
              </a>
            ))}
          </div>
        </Tarjeta>
      ) : null}
    </div>
  );
}

function Dato({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-zinc-500">{titulo}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}
