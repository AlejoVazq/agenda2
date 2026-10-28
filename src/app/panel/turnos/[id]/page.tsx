import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { EncabezadoPagina, Insignia, Tarjeta } from "@/components/ui";
import { requerirPanel } from "@/lib/auth";
import { crearSupabaseServidor } from "@/lib/supabase/server";
import type { TurnoConDetalle } from "@/lib/datos-panel";
import { fechaLocalISO, formatFechaLarga, formatHora, formatPrecio } from "@/lib/fechas";
import { linkWhatsApp } from "@/lib/whatsapp";
import { ESTADOS_TURNO } from "@/lib/tipos";
import { AccionesEstado, FormularioNotas, FormularioReprogramar } from "../formularios";

export const metadata: Metadata = { title: "Turno" };

const COLOR = { pendiente: "ambar", confirmado: "verde", cancelado: "rojo", completado: "gris" } as const;

export default async function PaginaTurno({ params }: PageProps<"/panel/turnos/[id]">) {
  const { id } = await params;
  const { negocio } = await requerirPanel();
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await crearSupabaseServidor();
  // RLS: un empleado no puede leer turnos de otra agenda (devuelve vacío => 404).
  const { data } = await supabase
    .from("turnos")
    .select(
      "id, inicio, fin, estado, precio, notas, origen, profesional_id, servicio_id, cancelado_por, created_at, servicio:servicios(nombre, duracion_min), profesional:profesionales(nombre, color), cliente:clientes(id, nombre, telefono, email)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const t = data as unknown as TurnoConDetalle & { cancelado_por: string | null; created_at: string };
  const tz = negocio.zona_horaria;
  const activo = t.estado === "pendiente" || t.estado === "confirmado";

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
            <Insignia>Canceló {t.cancelado_por === "cliente" ? "el cliente" : "el negocio"}</Insignia>
          ) : null}
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
        <AccionesEstado id={t.id} estado={t.estado} />
      </Tarjeta>

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
