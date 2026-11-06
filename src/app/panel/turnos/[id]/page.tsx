import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { BotonAccion } from "@/components/boton-accion";
import { Aviso, EncabezadoPagina, Insignia, Tarjeta } from "@/components/ui";
import { requerirPanel } from "@/lib/auth";
import { crearSupabaseServidor } from "@/lib/supabase/server";
import type { TurnoConDetalle } from "@/lib/datos-panel";
import { env } from "@/lib/env";
import { fechaLocalISO, formatFechaLarga, formatHora, formatPrecio } from "@/lib/fechas";
import { linkWhatsApp } from "@/lib/whatsapp";
import { ESTADOS_PAGO, ESTADOS_TURNO, type EstadoPago } from "@/lib/tipos";
import { marcarSenaDevuelta, marcarSenaPagada } from "../acciones";
import { AccionesEstado, FormularioNotas, FormularioReprogramar } from "../formularios";

export const metadata: Metadata = { title: "Turno" };

const COLOR = { pendiente: "ambar", confirmado: "verde", cancelado: "rojo", completado: "gris", ausente: "rojo" } as const;

export default async function PaginaTurno({ params }: PageProps<"/panel/turnos/[id]">) {
  const { id } = await params;
  const { negocio } = await requerirPanel();
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await crearSupabaseServidor();
  // RLS: un empleado no puede leer turnos de otra agenda (devuelve vacío => 404).
  const { data } = await supabase
    .from("turnos")
    .select(
      "id, inicio, fin, estado, precio, notas, origen, profesional_id, servicio_id, cancelado_por, created_at, token_cancelacion, sena_monto, pago_estado, pago_vence_at, google_event_id, servicio:servicios(nombre, duracion_min), profesional:profesionales(nombre, color), cliente:clientes(id, nombre, telefono, email)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const t = data as unknown as TurnoConDetalle & {
    cancelado_por: string | null;
    created_at: string;
    token_cancelacion: string;
    sena_monto: number | null;
    pago_estado: EstadoPago | null;
    pago_vence_at: string | null;
    google_event_id: string | null;
  };
  const tz = negocio.zona_horaria;
  const activo = t.estado === "pendiente" || t.estado === "confirmado";
  const futuro = new Date(t.fin) > new Date();
  const linkCliente = `${env.siteUrl}/t/${t.token_cancelacion}`;
  const nombre = t.cliente?.nombre.split(" ")[0] ?? "";
  const cuando = `${formatFechaLarga(t.inicio, tz)} a las ${formatHora(t.inicio, tz)} h`;
  const mensajes =
    t.cliente?.telefono && activo && futuro
      ? [
          t.pago_estado === "pendiente"
            ? {
                titulo: "Pedir la seña",
                texto: `Hola ${nombre}! Para confirmar tu turno de ${t.servicio?.nombre} el ${cuando} falta la seña de ${formatPrecio(t.sena_monto)}. Podés pagarla acá: ${linkCliente}`,
              }
            : {
                titulo: "Confirmar turno",
                texto: `Hola ${nombre}! Te confirmo tu turno de ${t.servicio?.nombre} el ${cuando} en ${negocio.nombre}. Podés verlo o cancelarlo acá: ${linkCliente}`,
              },
          {
            titulo: "Recordatorio",
            texto: `Hola ${nombre}! Te recuerdo tu turno de ${t.servicio?.nombre} el ${cuando} en ${negocio.nombre}${negocio.direccion ? ` (${negocio.direccion})` : ""}. Si no podés venir, avisame o cancelalo acá: ${linkCliente}`,
          },
          {
            titulo: "Avisar un cambio",
            texto: `Hola ${nombre}! Te escribo de ${negocio.nombre} por tu turno del ${cuando}. `,
          },
        ]
      : [];

  return (
    <div className="max-w-2xl space-y-6">
      <EncabezadoPagina
        titulo={t.cliente?.nombre ?? "Turno"}
        descripcion={
          <span className="capitalize">
            {formatFechaLarga(t.inicio, tz)} · {formatHora(t.inicio, tz)} a {formatHora(t.fin, tz)} h
          </span>
        }
        volver={{ href: "/panel/turnos", texto: "Turnos" }}
      />

      <Tarjeta className="space-y-5">
        <div className="flex flex-wrap gap-2">
          <Insignia color={COLOR[t.estado]}>{ESTADOS_TURNO[t.estado]}</Insignia>
          <Insignia color={t.origen === "online" ? "violeta" : "gris"}>
            {t.origen === "online" ? "Reserva online" : "Cargado en el panel"}
          </Insignia>
          {t.estado === "cancelado" && t.cancelado_por ? (
            <Insignia>
              {t.cancelado_por === "cliente"
                ? "Canceló el cliente"
                : t.cancelado_por === "sistema"
                  ? "No se pagó la seña"
                  : "Canceló el negocio"}
            </Insignia>
          ) : null}
          {t.pago_estado ? (
            <Insignia color={t.pago_estado === "aprobado" ? "verde" : t.pago_estado === "pendiente" || t.pago_estado === "reembolsar" ? "ambar" : "gris"}>
              {ESTADOS_PAGO[t.pago_estado]}
              {t.sena_monto ? ` · ${formatPrecio(t.sena_monto)}` : ""}
            </Insignia>
          ) : null}
          {t.google_event_id ? <Insignia color="gris">En Google Calendar</Insignia> : null}
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <Dato titulo="Servicio">{t.servicio?.nombre}</Dato>
          <Dato titulo="Profesional">{t.profesional?.nombre}</Dato>
          <Dato titulo="Precio">{formatPrecio(t.precio) ?? "—"}</Dato>
          <Dato titulo="Reservado el">
            {new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short", timeZone: tz }).format(new Date(t.created_at))}
          </Dato>
          <Dato titulo="Celular">
            {t.cliente?.telefono ? (
              <a href={linkWhatsApp(t.cliente.telefono)} target="_blank" className="text-marca-700 hover:underline">
                {t.cliente.telefono}
              </a>
            ) : (
              "—"
            )}
          </Dato>
          <Dato titulo="Email">{t.cliente?.email ?? "—"}</Dato>
        </dl>
        {t.pago_estado === "pendiente" && activo ? (
          <Aviso tipo="alerta">
            <p>
              El cliente todavía no pagó la seña. Si no la paga antes de las{" "}
              {t.pago_vence_at ? formatHora(t.pago_vence_at, tz) : "—"} h, el turno se libera solo.
            </p>
            <BotonAccion
              className="mt-2"
              accion={marcarSenaPagada.bind(null, t.id)}
              confirmar="Sí, la cobré"
              pendiente="Guardando…"
            >
              Ya la cobré por otro medio
            </BotonAccion>
          </Aviso>
        ) : null}
        {t.pago_estado === "reembolsar" ? (
          <Aviso tipo="alerta">
            <p>
              El cliente pagó {formatPrecio(t.sena_monto)} de seña pero el turno no quedó vigente. Devolvele la plata desde
              Mercado Pago (Actividad → el pago → Devolver).
            </p>
            <BotonAccion
              className="mt-2"
              accion={marcarSenaDevuelta.bind(null, t.id)}
              confirmar="Sí, ya la devolví"
              pendiente="Guardando…"
            >
              Marcar como devuelta
            </BotonAccion>
          </Aviso>
        ) : null}
        <AccionesEstado id={t.id} estado={t.estado} yaEmpezo={new Date(t.inicio) <= new Date()} />
      </Tarjeta>

      {mensajes.length && t.cliente ? (
        <Tarjeta>
          <h2 className="mb-1 font-bold">Escribirle por WhatsApp</h2>
          <p className="mb-3 text-sm text-zinc-600">Abre WhatsApp con el mensaje listo para enviar.</p>
          <div className="flex flex-wrap gap-2">
            {mensajes.map((m) => (
              <a
                key={m.titulo}
                href={linkWhatsApp(t.cliente!.telefono, m.texto)}
                target="_blank"
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
              >
                {m.titulo}
              </a>
            ))}
          </div>
        </Tarjeta>
      ) : null}

      {activo ? (
        <Tarjeta>
          <h2 className="mb-3 font-bold">Reprogramar</h2>
          <FormularioReprogramar id={t.id} fecha={fechaLocalISO(t.inicio, tz)} hora={formatHora(t.inicio, tz)} />
        </Tarjeta>
      ) : null}

      <Tarjeta>
        <FormularioNotas id={t.id} notas={t.notas} />
      </Tarjeta>
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
