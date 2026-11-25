import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BotonCopiar } from "@/components/copiar";
import { IconoWhatsApp } from "@/components/icono-whatsapp";
import { Aviso, BotonLink, cx, Insignia, Logo } from "@/components/ui";
import { estiloTema } from "@/lib/apariencia";
import { env } from "@/lib/env";
import { procesarPagoYAvisar } from "@/lib/eventos";
import { fechaLocalISO, formatFechaHora, formatFechaLarga, formatHora, formatPrecio } from "@/lib/fechas";
import { pedidoDeToken, verPedido } from "@/lib/pedidos";
import { aparienciaNegocio } from "@/lib/portada";
import { linkWhatsApp } from "@/lib/publico";
import { ESTADOS_PEDIDO, MEDIOS_PEDIDO, type EstadoPedido } from "@/lib/tipos";
import { CancelarPedido } from "./cancelar";
import { PagarPedido } from "./pagar";
import { VaciarCarrito } from "./vaciar-carrito";

// El token del link es secreto: no indexar ni filtrarlo como referrer.
export const metadata: Metadata = {
  title: "Tu pedido",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const COLOR_ESTADO: Record<EstadoPedido, "ambar" | "verde" | "gris" | "rojo"> = {
  pendiente: "ambar",
  pagado: "verde",
  entregado: "gris",
  cancelado: "rojo",
  vencido: "rojo",
  reembolsar: "ambar",
};

export default async function PaginaPedido({ params, searchParams }: PageProps<"/p/[token]">) {
  const { token } = await params;
  const sp = await searchParams;
  const nuevo = Boolean(sp.nuevo);
  const pagoId = typeof sp.payment_id === "string" ? sp.payment_id : typeof sp.collection_id === "string" ? sp.collection_id : null;
  const estadoVuelta = typeof sp.status === "string" ? sp.status : typeof sp.collection_status === "string" ? sp.collection_status : null;

  const guardado = await pedidoDeToken(token);
  if (!guardado) notFound();

  // Vuelta desde Mercado Pago: se verifica el pago contra la API (no se confía en la URL).
  // El webhook hace lo mismo; lo que llegue primero lo registra y el otro no repite nada.
  if (
    pagoId &&
    /^\d{1,20}$/.test(pagoId) &&
    (guardado.estado === "pendiente" || guardado.estado === "vencido" || guardado.estado === "cancelado")
  ) {
    await procesarPagoYAvisar(guardado.negocio_id, pagoId, guardado.id).catch((e) => console.error("[pago] vuelta pedido", e));
  }

  const [pedido, apariencia] = await Promise.all([verPedido(token), aparienciaNegocio(guardado.negocio_id)]);
  if (!pedido) notFound();

  const tema = estiloTema(apariencia.color);
  const neg = pedido.negocio;
  const tz = neg.zona_horaria;
  const total = formatPrecio(pedido.total) ?? "";
  const pendiente = pedido.estado === "pendiente";
  const recienPagado = Boolean(pagoId) && pedido.estado === "pagado";
  const vueltaSinPagar = pendiente && pedido.medio === "mercadopago" && estadoVuelta && estadoVuelta !== "approved" && estadoVuelta !== "null";
  const link = `${env.siteUrl}/p/${token}`;
  // Efectivo con turno: el plazo termina al final del día del turno.
  const venceElDiaDelTurno =
    pedido.turno !== null &&
    pedido.vence_at !== null &&
    fechaLocalISO(new Date(new Date(pedido.vence_at).getTime() - 1000), tz) === fechaLocalISO(pedido.turno.inicio, tz);

  let encabezado: { titulo: string; texto: string; icono: "ok" | "reloj" } | null = null;
  if (recienPagado) {
    encabezado = { titulo: "¡Pago confirmado!", texto: `Ya podés retirar tu pedido en ${neg.nombre}.`, icono: "ok" };
  } else if (pendiente && pedido.medio === "mercadopago" && (nuevo || pagoId)) {
    encabezado = {
      titulo: "¡Ya casi!",
      texto: `Pagá con Mercado Pago para confirmar tu pedido. Te lo guardamos hasta las ${formatHora(pedido.vence_at!, tz)} h.`,
      icono: "reloj",
    };
  } else if (pendiente && nuevo) {
    encabezado = {
      titulo: "¡Pedido recibido!",
      texto:
        pedido.medio === "transferencia"
          ? `Transferí ${total} para confirmarlo. Te mandamos los datos por mail.`
          : "Te lo guardamos. Lo pagás cuando lo retirás.",
      icono: "ok",
    };
  }

  return (
    <div className={cx("relative min-h-dvh overflow-x-clip bg-fondo", tema && "tema-negocio")} style={tema}>
      {nuevo || pagoId ? <VaciarCarrito slug={neg.slug} /> : null}
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-0 h-80 overflow-hidden" aria-hidden>
        <div className="absolute -right-24 -top-32 size-96 rounded-full bg-marca-200/60 blur-3xl" />
        <div className="absolute -left-24 -top-16 size-80 rounded-full bg-acento-100/80 blur-3xl" />
      </div>
      <main className="relative mx-auto max-w-md px-4 pb-16 pt-10">
        {encabezado ? (
          <div className="mb-7 animate-aparecer text-center">
            <span
              className={
                encabezado.icono === "ok"
                  ? "mx-auto grid size-18 animate-sello place-items-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-[0_12px_30px_-10px_rgb(5_150_105/0.7)] ring-8 ring-emerald-100/70"
                  : "mx-auto grid size-18 animate-sello place-items-center rounded-full bg-gradient-to-br from-amber-300 to-amber-500 text-white shadow-[0_12px_30px_-10px_rgb(217_119_6/0.6)] ring-8 ring-amber-100/70"
              }
              aria-hidden
            >
              {encabezado.icono === "ok" ? (
                <svg viewBox="0 0 24 24" fill="none" className="size-9">
                  <path
                    d="m5 12 5 5L20 7"
                    pathLength={1}
                    strokeDasharray={1}
                    className="animate-trazo"
                    stroke="currentColor"
                    strokeWidth="2.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" className="size-8">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                  <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              )}
            </span>
            <h1 className="mt-5 font-display text-3xl font-bold tracking-tight">{encabezado.titulo}</h1>
            <p className="mt-1.5 text-zinc-600">{encabezado.texto}</p>
          </div>
        ) : (
          <h1 className="mb-7 text-center font-display text-3xl font-bold tracking-tight">Tu pedido</h1>
        )}

        {vueltaSinPagar ? (
          <Aviso tipo="error" className="mb-4">
            El pago no se aprobó. Podés intentarlo de nuevo con otro medio de pago.
          </Aviso>
        ) : null}

        {pendiente && pedido.medio === "mercadopago" ? (
          <div className="mb-4">
            <PagarPedido token={token} monto={total} />
          </div>
        ) : null}

        <div className="animate-aparecer overflow-hidden rounded-[2rem] bg-white shadow-flotante ring-1 ring-zinc-200/60 retraso-1">
          <div
            className={cx(
              "relative overflow-hidden px-5 pb-6 pt-5 text-white",
              tema ? "cabecera-tema" : "bg-noche bg-[radial-gradient(ellipse_80%_100%_at_100%_0%,rgb(79_146_114/0.6),transparent)]",
            )}
          >
            <div className="fondo-grano pointer-events-none absolute inset-0 opacity-60" aria-hidden />
            <div className="relative flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className={cx("text-xs font-semibold uppercase tracking-[0.14em]", tema ? "text-white/80" : "text-acento-300")}>
                  {neg.nombre}
                </p>
                <p className="mt-1 font-display text-2xl font-bold leading-tight">Pedido #{pedido.numero}</p>
              </div>
              <Insignia color={COLOR_ESTADO[pedido.estado]}>{ESTADOS_PEDIDO[pedido.estado]}</Insignia>
            </div>
            <div className="relative mt-5 flex items-end gap-3">
              <p className="font-display text-4xl font-bold tabular-nums leading-none">{total}</p>
              <p className="pb-0.5 text-sm text-white/70">{MEDIOS_PEDIDO[pedido.medio]}</p>
            </div>
          </div>

          {/* Troquelado de ticket */}
          <div className="relative h-0" aria-hidden>
            <span className="absolute -left-3 -top-3 size-6 rounded-full bg-fondo" />
            <span className="absolute -right-3 -top-3 size-6 rounded-full bg-fondo" />
          </div>

          <div className="px-5 pb-5">
            <ul className="mt-4 divide-y divide-dashed divide-zinc-200 text-sm">
              {pedido.items.map((i, n) => (
                <li key={n} className="flex items-start justify-between gap-3 py-2.5">
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    <span className="font-semibold tabular-nums">{i.cantidad} ×</span> {i.nombre}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">{formatPrecio(i.cantidad * i.precio_unitario)}</span>
                </li>
              ))}
            </ul>
            <dl className="divide-y divide-dashed divide-zinc-200 border-t border-zinc-200 text-sm">
              <Fila titulo="Total">{total}</Fila>
              {pendiente && pedido.vence_at ? (
                <Fila titulo={pedido.medio === "efectivo" ? "Retiralo hasta" : "Pagá hasta"}>
                  {venceElDiaDelTurno ? "El día de tu turno" : `${formatFechaHora(pedido.vence_at, tz)} h`}
                </Fila>
              ) : null}
              {pedido.turno ? (
                <Fila titulo="Tu turno">
                  <span className="first-letter:uppercase">
                    {formatFechaLarga(pedido.turno.inicio, tz)} · {formatHora(pedido.turno.inicio, tz)} h
                  </span>
                </Fila>
              ) : null}
              {neg.direccion ? (
                <Fila titulo="Dónde">
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(neg.direccion)}`}
                    target="_blank"
                    className="text-marca-700 hover:underline"
                  >
                    {neg.direccion}
                  </a>
                </Fila>
              ) : null}
            </dl>
          </div>
        </div>

        {pendiente && pedido.medio === "transferencia" ? (
          <section
            aria-labelledby="t-transferencia"
            className="mt-6 animate-aparecer rounded-[2rem] bg-white p-5 shadow-suave ring-1 ring-zinc-200/60 retraso-2"
          >
            <h2 id="t-transferencia" className="font-display text-xl font-bold">
              Cómo transferir
            </h2>
            <dl className="mt-3 divide-y divide-dashed divide-zinc-200 text-sm">
              {neg.transferencia_alias ? <DatoCopiable titulo="Alias" valor={neg.transferencia_alias} /> : null}
              {neg.transferencia_cbu ? <DatoCopiable titulo="CBU / CVU" valor={neg.transferencia_cbu} /> : null}
              {neg.transferencia_titular ? (
                <div className="py-3">
                  <dt className="text-zinc-500">Titular</dt>
                  <dd className="mt-0.5 font-semibold [overflow-wrap:anywhere]">{neg.transferencia_titular}</dd>
                </div>
              ) : null}
              <DatoCopiable titulo="Monto" valor={String(Math.round(pedido.total))} mostrar={total} />
            </dl>
            <Aviso tipo="info" className="mt-3">
              Poné <strong>Pedido #{pedido.numero}</strong> en el concepto
              {pedido.vence_at ? ` y transferí antes del ${formatFechaHora(pedido.vence_at, tz)} h` : ""}. Después avisale al negocio.
            </Aviso>
            {neg.telefono ? (
              <a
                href={linkWhatsApp(neg.telefono, `Hola! Te transferí el pedido #${pedido.numero} (${total}).`)}
                target="_blank"
                className="mt-4 flex h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 font-semibold text-white shadow-[0_8px_20px_-8px_rgb(5_150_105/0.6)] transition hover:bg-emerald-700"
              >
                <IconoWhatsApp className="size-5" />
                Avisar que transferí
              </a>
            ) : null}
          </section>
        ) : null}

        {pendiente && pedido.medio === "efectivo" ? (
          <Aviso tipo="info" className="mt-6">
            <p className="font-semibold">Pagás en el local</p>
            <p className="mt-0.5">
              {venceElDiaDelTurno && pedido.turno
                ? `Lo retirás y pagás el día de tu turno (${formatFechaLarga(pedido.turno.inicio, tz)}).`
                : pedido.vence_at
                  ? `Lo retirás y pagás en el local hasta el ${formatFechaHora(pedido.vence_at, tz)} h.`
                  : "Lo retirás y pagás en el local."}{" "}
              Después de esa fecha los productos vuelven a la venta.
            </p>
          </Aviso>
        ) : null}

        {pedido.estado === "pagado" ? (
          <Aviso tipo="exito" className="mt-6">
            <p className="font-semibold">Pedido pagado</p>
            <p className="mt-0.5">
              {pedido.turno ? "Lo retirás el día de tu turno." : `Ya podés retirarlo en ${neg.nombre}.`}
            </p>
          </Aviso>
        ) : null}

        {pedido.estado === "entregado" ? (
          <Aviso tipo="info" className="mt-6">
            Ya retiraste este pedido. ¡Gracias por tu compra!
          </Aviso>
        ) : null}

        {pedido.estado === "vencido" ? (
          <Aviso tipo="alerta" className="mt-6">
            Se venció el plazo para pagar y los productos volvieron a la venta. Podés hacer otro pedido cuando quieras.
          </Aviso>
        ) : null}

        {pedido.estado === "cancelado" ? (
          <Aviso tipo="alerta" className="mt-6">
            {pedido.cancelado_por === "cliente"
              ? "Cancelaste este pedido."
              : pedido.cancelado_por === "negocio"
                ? `${neg.nombre} canceló este pedido.${pedido.pagado_at ? " Se van a comunicar con vos para devolverte la plata." : ""}`
                : "Este pedido se canceló."}
          </Aviso>
        ) : null}

        {pedido.estado === "reembolsar" ? (
          <Aviso tipo="alerta" className="mt-6">
            <p className="font-semibold">Recibimos tu pago, pero los productos ya no están disponibles.</p>
            <p className="mt-0.5">
              {neg.nombre} se va a comunicar con vos para devolverte la plata
              {neg.telefono ? " o podés escribirle directamente" : ""}.
            </p>
            {neg.telefono ? (
              <a
                href={linkWhatsApp(neg.telefono, `Hola! Pagué el pedido #${pedido.numero} pero no quedó confirmado.`)}
                target="_blank"
                className="mt-2 inline-block font-semibold underline"
              >
                Escribir por WhatsApp
              </a>
            ) : null}
          </Aviso>
        ) : null}

        {pendiente || pedido.estado === "pagado" ? (
          <div className="mt-6 space-y-4">
            <Aviso tipo="info">
              <p className="font-semibold">Guardá este link</p>
              <p className="mt-0.5">Con él podés ver tu pedido{pendiente ? " o cancelarlo" : ""} cuando quieras, sin crear una cuenta.</p>
              <div className="mt-2">
                <BotonCopiar texto={link} />
              </div>
            </Aviso>
            {pendiente ? <CancelarPedido token={token} /> : null}
          </div>
        ) : null}

        <div className="mt-8 flex flex-col items-center gap-1">
          {neg.telefono && pedido.medio !== "transferencia" ? (
            <a
              href={linkWhatsApp(neg.telefono, `Hola! Te escribo por el pedido #${pedido.numero}.`)}
              target="_blank"
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-marca-700 transition hover:bg-marca-50"
            >
              <IconoWhatsApp className="size-4" />
              Escribirle al negocio
            </a>
          ) : null}
          <BotonLink href={`/n/${neg.slug}`} variante="fantasma">
            Ir a {neg.nombre}
          </BotonLink>
        </div>
        <footer className="mt-10 flex justify-center">
          <Link href="/" className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs text-zinc-500 transition hover:bg-white hover:text-tinta">
            Turnos online con <Logo className="origin-left scale-[0.8]" />
          </Link>
        </footer>
      </main>
    </div>
  );
}

function Fila({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-3">
      <dt className="text-zinc-500">{titulo}</dt>
      <dd className="text-right font-semibold">{children}</dd>
    </div>
  );
}

function DatoCopiable({ titulo, valor, mostrar }: { titulo: string; valor: string; mostrar?: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 py-3">
      <dt className="text-zinc-500">{titulo}</dt>
      <dd className="col-start-1 mt-0.5 font-semibold tabular-nums [overflow-wrap:anywhere]">{mostrar ?? valor}</dd>
      <dd className="col-start-2 row-span-2 row-start-1">
        <BotonCopiar texto={valor} etiqueta="Copiar" />
      </dd>
    </div>
  );
}
