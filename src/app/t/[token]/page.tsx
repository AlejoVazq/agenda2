import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Aviso, BotonLink, Insignia, Logo } from "@/components/ui";
import { BotonCopiar } from "@/components/copiar";
import { env } from "@/lib/env";
import { procesarPagoYAvisar } from "@/lib/eventos";
import { formatFechaHora, formatFechaLarga, formatHora, formatPrecio } from "@/lib/fechas";
import { getTurnoPublico, linkWhatsApp } from "@/lib/publico";
import { crearSupabaseAdmin } from "@/lib/supabase/admin";
import { ESTADOS_TURNO } from "@/lib/tipos";
import { CancelarTurno } from "./cancelar";
import { PagarSena } from "./pagar";

// El token del link es secreto: no indexar ni filtrarlo como referrer.
export const metadata: Metadata = {
  title: "Tu turno",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

function fechaGoogle(iso: string) {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * Vuelta desde Mercado Pago: verifica el pago contra la API (no se confía en los
 * parámetros de la URL) antes de mostrar el turno. El webhook hace lo mismo; lo
 * que llegue primero lo registra y el otro no repite nada.
 */
async function verificarVueltaDePago(token: string, pagoId: string) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !/^\d{1,20}$/.test(pagoId)) return;
  const admin = crearSupabaseAdmin();
  const { data } = await admin
    .from("turnos")
    .select("id, negocio_id, pago_estado")
    .eq("token_cancelacion", token)
    .maybeSingle();
  if (!data || (data.pago_estado !== "pendiente" && data.pago_estado !== "vencido")) return;
  await procesarPagoYAvisar(data.negocio_id, pagoId, data.id).catch((e) => console.error("[pago] vuelta", e));
}

export default async function PaginaTurno({ params, searchParams }: PageProps<"/t/[token]">) {
  const { token } = await params;
  const sp = await searchParams;
  const nueva = sp.nueva;
  const pagoId = typeof sp.payment_id === "string" ? sp.payment_id : typeof sp.collection_id === "string" ? sp.collection_id : null;
  const estadoVuelta = typeof sp.status === "string" ? sp.status : typeof sp.collection_status === "string" ? sp.collection_status : null;

  if (/^[0-9a-f]{64}$/.test(token) && pagoId && pagoId !== "null") await verificarVueltaDePago(token, pagoId);

  const turno = await getTurnoPublico(token);
  if (!turno) notFound();

  const tz = turno.negocio.zona_horaria;
  const esperandoSena = turno.pago_estado === "pendiente" && turno.estado !== "cancelado";
  const senaVencida = turno.pago_estado === "vencido";
  const activo = (turno.estado === "pendiente" || turno.estado === "confirmado") && !senaVencida;
  const pasado = new Date(turno.inicio) < new Date();
  const link = `${env.siteUrl}/t/${token}`;
  const sena = formatPrecio(turno.sena_monto);
  const recienPagado = Boolean(pagoId) && turno.pago_estado === "aprobado";

  const googleCal = new URL("https://calendar.google.com/calendar/render");
  googleCal.searchParams.set("action", "TEMPLATE");
  googleCal.searchParams.set("text", `${turno.servicio} - ${turno.negocio.nombre}`);
  googleCal.searchParams.set("dates", `${fechaGoogle(turno.inicio)}/${fechaGoogle(turno.fin)}`);
  if (turno.negocio.direccion) googleCal.searchParams.set("location", turno.negocio.direccion);

  const colorEstado = { pendiente: "ambar", confirmado: "verde", cancelado: "rojo", completado: "gris", ausente: "rojo" } as const;
  const etiquetaEstado = esperandoSena
    ? "Falta la seña"
    : senaVencida && turno.estado !== "cancelado"
      ? "Liberado"
      : ESTADOS_TURNO[turno.estado];

  let encabezado: { titulo: string; texto: string; icono: "ok" | "reloj" } | null = null;
  if (esperandoSena) {
    encabezado = {
      titulo: "¡Ya casi!",
      texto: `Pagá la seña para confirmar tu turno. Te lo guardamos hasta las ${formatHora(turno.pago_vence_at!, tz)} h.`,
      icono: "reloj",
    };
  } else if ((nueva || recienPagado) && activo) {
    encabezado =
      turno.estado === "pendiente"
        ? { titulo: "¡Reserva recibida!", texto: "El negocio la tiene que confirmar. Te avisarán por teléfono o mail.", icono: "ok" }
        : { titulo: "¡Turno reservado!", texto: `Te esperamos, ${turno.cliente.split(" ")[0]}.`, icono: "ok" };
  }

  return (
    <div className="min-h-dvh bg-gradient-to-b from-marca-50 to-fondo">
      <main className="mx-auto max-w-md px-4 pb-16 pt-8">
        {encabezado ? (
          <div className="mb-6 text-center">
            <span
              className={
                encabezado.icono === "ok"
                  ? "mx-auto grid size-16 place-items-center rounded-full bg-emerald-100 text-3xl text-emerald-700"
                  : "mx-auto grid size-16 place-items-center rounded-full bg-amber-100 text-amber-700"
              }
              aria-hidden
            >
              {encabezado.icono === "ok" ? (
                "✓"
              ) : (
                <svg viewBox="0 0 24 24" fill="none" className="size-8">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                  <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              )}
            </span>
            <h1 className="mt-4 text-2xl font-extrabold tracking-tight">{encabezado.titulo}</h1>
            <p className="mt-1 text-sm text-zinc-600">{encabezado.texto}</p>
          </div>
        ) : (
          <h1 className="mb-6 text-center text-2xl font-extrabold tracking-tight">Tu turno</h1>
        )}

        {esperandoSena && estadoVuelta && estadoVuelta !== "approved" && estadoVuelta !== "null" ? (
          <Aviso tipo="error" className="mb-4">
            El pago no se aprobó. Podés intentarlo de nuevo con otro medio de pago.
          </Aviso>
        ) : null}

        {esperandoSena && !pasado ? (
          <div className="mb-4">
            <PagarSena token={token} monto={sena ?? ""} />
          </div>
        ) : null}

        <div className="rounded-3xl bg-white p-5 shadow-xl shadow-marca-900/10">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-marca-700">{turno.negocio.nombre}</p>
              <p className="text-xl font-bold">{turno.servicio}</p>
            </div>
            <Insignia color={esperandoSena ? "ambar" : senaVencida ? "rojo" : colorEstado[turno.estado]}>{etiquetaEstado}</Insignia>
          </div>

          <dl className="mt-5 space-y-3 text-sm">
            <Fila titulo="Día">
              <span className="capitalize">{formatFechaLarga(turno.inicio, tz)}</span>
            </Fila>
            <Fila titulo="Horario">
              {formatHora(turno.inicio, tz)} a {formatHora(turno.fin, tz)} h
            </Fila>
            <Fila titulo="Con">{turno.profesional}</Fila>
            {turno.precio !== null ? <Fila titulo="Precio">{formatPrecio(turno.precio)}</Fila> : null}
            {sena ? (
              <Fila titulo="Seña">
                {sena}{" "}
                {turno.pago_estado === "aprobado" ? (
                  <span className="font-medium text-emerald-700">· pagada</span>
                ) : turno.pago_estado === "pendiente" ? (
                  <span className="font-medium text-amber-700">· pendiente</span>
                ) : null}
              </Fila>
            ) : null}
            {turno.negocio.direccion ? (
              <Fila titulo="Dónde">
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(turno.negocio.direccion)}`}
                  target="_blank"
                  className="text-marca-700 hover:underline"
                >
                  {turno.negocio.direccion}
                </a>
              </Fila>
            ) : null}
          </dl>

          {activo && !pasado && !esperandoSena ? (
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              <a
                href={googleCal.toString()}
                target="_blank"
                className="inline-flex h-11 items-center justify-center rounded-xl border border-zinc-200 text-sm font-semibold hover:bg-zinc-50"
              >
                Google Calendar
              </a>
              <a
                href={`/t/${token}/ics`}
                className="inline-flex h-11 items-center justify-center rounded-xl border border-zinc-200 text-sm font-semibold hover:bg-zinc-50"
              >
                Apple / Outlook
              </a>
              {turno.negocio.telefono ? (
                <a
                  href={linkWhatsApp(
                    turno.negocio.telefono,
                    `Hola! Tengo un turno el ${formatFechaHora(turno.inicio, tz)} (${turno.servicio}).`,
                  )}
                  target="_blank"
                  className="inline-flex h-11 items-center justify-center rounded-xl border border-zinc-200 text-sm font-semibold hover:bg-zinc-50 sm:col-span-2"
                >
                  Escribirle al negocio
                </a>
              ) : null}
            </div>
          ) : null}
        </div>

        {senaVencida ? (
          <Aviso tipo="alerta" className="mt-6">
            Se venció el plazo para pagar la seña y el horario se liberó. Podés reservar otro turno cuando quieras.
          </Aviso>
        ) : null}

        {turno.pago_estado === "reembolsar" ? (
          <Aviso tipo="alerta" className="mt-6">
            <p className="font-semibold">Recibimos tu pago, pero el turno ya no está disponible.</p>
            <p className="mt-0.5">
              {turno.negocio.nombre} se va a comunicar con vos para devolverte la seña
              {turno.negocio.telefono ? " o podés escribirle directamente" : ""}.
            </p>
            {turno.negocio.telefono ? (
              <a
                href={linkWhatsApp(turno.negocio.telefono, `Hola! Pagué una seña para el ${formatFechaHora(turno.inicio, tz)} pero el turno no quedó confirmado.`)}
                target="_blank"
                className="mt-2 inline-block font-semibold underline"
              >
                Escribir por WhatsApp
              </a>
            ) : null}
          </Aviso>
        ) : null}

        {turno.estado === "cancelado" && turno.cancelado_por === "negocio" ? (
          <Aviso tipo="alerta" className="mt-6">
            El negocio canceló este turno.
            {turno.pago_estado === "aprobado" ? " Comunicate con ellos por la devolución de la seña." : ""}
          </Aviso>
        ) : null}

        {activo && !pasado ? (
          <div className="mt-6 space-y-4">
            <Aviso tipo="info">
              <p className="font-semibold">Guardá este link</p>
              <p className="mt-0.5">Con él podés ver o cancelar tu turno cuando quieras, sin crear una cuenta.</p>
              <div className="mt-2">
                <BotonCopiar texto={link} />
              </div>
            </Aviso>

            {turno.puede_cancelar ? (
              <div>
                <CancelarTurno token={token} />
                <p className="mt-2 text-center text-xs text-zinc-500">
                  {turno.cancelacion_min_horas > 0
                    ? `Podés cancelar online hasta el ${formatFechaHora(turno.cancelable_hasta, tz)}.`
                    : "Podés cancelar online hasta el momento del turno."}
                  {turno.pago_estado === "aprobado" ? " La devolución de la seña la coordinás con el negocio." : ""}
                </p>
              </div>
            ) : (
              <Aviso tipo="alerta">
                Ya pasó el plazo para cancelar online ({turno.cancelacion_min_horas} h antes). Si no podés venir, avisale al
                negocio.
              </Aviso>
            )}
          </div>
        ) : null}

        <div className="mt-8 text-center">
          <BotonLink href={`/n/${turno.negocio.slug}`} variante="fantasma">
            {activo ? `Ir a ${turno.negocio.nombre}` : "Reservar otro turno"}
          </BotonLink>
        </div>
        <footer className="mt-10 flex justify-center opacity-60">
          <Link href="/">
            <Logo className="scale-75" />
          </Link>
        </footer>
      </main>
    </div>
  );
}

function Fila({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-zinc-500">{titulo}</dt>
      <dd className="text-right font-semibold">{children}</dd>
    </div>
  );
}
