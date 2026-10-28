import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Aviso, BotonLink, Insignia, Logo } from "@/components/ui";
import { BotonCopiar } from "@/components/copiar";
import { env } from "@/lib/env";
import { formatFechaHora, formatFechaLarga, formatHora, formatPrecio } from "@/lib/fechas";
import { getTurnoPublico, linkWhatsApp } from "@/lib/publico";
import { ESTADOS_TURNO } from "@/lib/tipos";
import { CancelarTurno } from "./cancelar";

// El token del link es secreto: no indexar ni filtrarlo como referrer.
export const metadata: Metadata = {
  title: "Tu turno",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

function fechaGoogle(iso: string) {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export default async function PaginaTurno({ params, searchParams }: PageProps<"/t/[token]">) {
  const { token } = await params;
  const { nueva } = await searchParams;
  const turno = await getTurnoPublico(token);
  if (!turno) notFound();

  const tz = turno.negocio.zona_horaria;
  const activo = turno.estado === "pendiente" || turno.estado === "confirmado";
  const pasado = new Date(turno.inicio) < new Date();
  const link = `${env.siteUrl}/t/${token}`;

  const googleCal = new URL("https://calendar.google.com/calendar/render");
  googleCal.searchParams.set("action", "TEMPLATE");
  googleCal.searchParams.set("text", `${turno.servicio} - ${turno.negocio.nombre}`);
  googleCal.searchParams.set("dates", `${fechaGoogle(turno.inicio)}/${fechaGoogle(turno.fin)}`);
  if (turno.negocio.direccion) googleCal.searchParams.set("location", turno.negocio.direccion);

  const colorEstado = { pendiente: "ambar", confirmado: "verde", cancelado: "rojo", completado: "gris" } as const;

  return (
    <div className="min-h-dvh bg-gradient-to-b from-marca-50 to-fondo">
      <main className="mx-auto max-w-md px-4 pb-16 pt-8">
        {nueva && activo ? (
          <div className="mb-6 text-center">
            <span className="mx-auto grid size-16 place-items-center rounded-full bg-emerald-100 text-3xl text-emerald-700">✓</span>
            <h1 className="mt-4 text-2xl font-extrabold tracking-tight">
              {turno.estado === "pendiente" ? "¡Reserva recibida!" : "¡Turno reservado!"}
            </h1>
            <p className="mt-1 text-sm text-zinc-600">
              {turno.estado === "pendiente"
                ? "El negocio la tiene que confirmar. Te avisarán por teléfono o mail."
                : `Te esperamos, ${turno.cliente.split(" ")[0]}.`}
            </p>
          </div>
        ) : (
          <h1 className="mb-6 text-center text-2xl font-extrabold tracking-tight">Tu turno</h1>
        )}

        <div className="rounded-3xl bg-white p-5 shadow-xl shadow-marca-900/10">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-marca-700">{turno.negocio.nombre}</p>
              <p className="text-xl font-bold">{turno.servicio}</p>
            </div>
            <Insignia color={colorEstado[turno.estado]}>{ESTADOS_TURNO[turno.estado]}</Insignia>
          </div>

          <dl className="mt-5 space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Día</dt>
              <dd className="text-right font-semibold capitalize">{formatFechaLarga(turno.inicio, tz)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Horario</dt>
              <dd className="font-semibold">
                {formatHora(turno.inicio, tz)} a {formatHora(turno.fin, tz)} h
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Con</dt>
              <dd className="font-semibold">{turno.profesional}</dd>
            </div>
            {turno.precio !== null ? (
              <div className="flex justify-between gap-4">
                <dt className="text-zinc-500">Precio</dt>
                <dd className="font-semibold">{formatPrecio(turno.precio)}</dd>
              </div>
            ) : null}
            {turno.negocio.direccion ? (
              <div className="flex justify-between gap-4">
                <dt className="text-zinc-500">Dónde</dt>
                <dd className="text-right font-semibold">
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(turno.negocio.direccion)}`}
                    target="_blank"
                    className="text-marca-700 hover:underline"
                  >
                    {turno.negocio.direccion}
                  </a>
                </dd>
              </div>
            ) : null}
          </dl>

          {activo && !pasado ? (
            <div className="mt-6 grid gap-2">
              <a
                href={googleCal.toString()}
                target="_blank"
                className="inline-flex h-11 items-center justify-center rounded-xl border border-zinc-200 text-sm font-semibold hover:bg-zinc-50"
              >
                Agregar a mi calendario
              </a>
              {turno.negocio.telefono ? (
                <a
                  href={linkWhatsApp(
                    turno.negocio.telefono,
                    `Hola! Tengo un turno el ${formatFechaHora(turno.inicio, tz)} (${turno.servicio}).`,
                  )}
                  target="_blank"
                  className="inline-flex h-11 items-center justify-center rounded-xl border border-zinc-200 text-sm font-semibold hover:bg-zinc-50"
                >
                  Escribirle al negocio
                </a>
              ) : null}
            </div>
          ) : null}
        </div>

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
                {turno.cancelacion_min_horas > 0 ? (
                  <p className="mt-2 text-center text-xs text-zinc-500">
                    Podés cancelar online hasta el {formatFechaHora(turno.cancelable_hasta, tz)}.
                  </p>
                ) : null}
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
            {turno.estado === "cancelado" ? "Reservar otro turno" : `Ir a ${turno.negocio.nombre}`}
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
