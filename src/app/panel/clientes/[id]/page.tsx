import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { BotonAccion } from "@/components/boton-accion";
import { Aviso, BotonLink, EncabezadoPagina, Insignia, Tarjeta } from "@/components/ui";
import { requerirDueno } from "@/lib/auth";
import { formatFechaCorta, formatHora, formatPrecio } from "@/lib/fechas";
import { comoUsuario, sql } from "@/lib/db";
import { ESTADOS_TURNO, type Cliente, type EstadoTurno } from "@/lib/tipos";
import { linkWhatsApp } from "@/lib/whatsapp";
import { quitarLimiteCliente } from "../acciones";
import { FormularioCliente } from "./formulario";

export const metadata: Metadata = { title: "Cliente" };

const COLOR = { pendiente: "ambar", confirmado: "verde", cancelado: "rojo", completado: "gris", ausente: "rojo" } as const;

type TurnoCliente = {
  id: string;
  inicio: string;
  estado: EstadoTurno;
  precio: number | null;
  cancelado_por: string | null;
  servicio: { nombre: string } | null;
  profesional: { nombre: string } | null;
};

export default async function PaginaCliente({ params }: PageProps<"/panel/clientes/[id]">) {
  const { id } = await params;
  const { negocio, userId } = await requerirDueno();
  if (!z.uuid().safeParse(id).success) notFound();

  const [c, turnos] = await comoUsuario(userId, (tx) =>
    Promise.all([
      tx.uno<Cliente & { created_at: string; ausencias_perdonadas_at: string | null }>(sql`
        select id, nombre, telefono, email, notas, created_at, ausencias_perdonadas_at
        from public.clientes where id = ${id}`),
      tx.varios<TurnoCliente>(sql`
        select t.id, t.inicio, t.estado, t.precio, t.cancelado_por,
               json_build_object('nombre', s.nombre) as servicio,
               json_build_object('nombre', p.nombre) as profesional
        from public.turnos t
        join public.servicios s on s.id = t.servicio_id
        join public.profesionales p on p.id = t.profesional_id
        where t.cliente_id = ${id}
        order by t.inicio desc
        limit 100`),
    ]),
  );
  if (!c) notFound();
  const tz = negocio.zona_horaria;

  const ahora = new Date().toISOString();
  const atendidos = turnos.filter((t) => t.estado === "completado" || (t.estado === "confirmado" && t.inicio < ahora));
  const canceladosCliente = turnos.filter((t) => t.estado === "cancelado" && t.cancelado_por === "cliente").length;
  const gastado = atendidos.reduce((total, t) => total + Number(t.precio ?? 0), 0);
  const ausencias = turnos.filter((t) => t.estado === "ausente");
  // Misma regla que crear_reserva: las ausencias perdonadas ya no limitan.
  const limitado = ausencias.filter((t) => !c.ausencias_perdonadas_at || new Date(t.inicio) > new Date(c.ausencias_perdonadas_at)).length >= 3;

  return (
    <div className="max-w-3xl space-y-6">
      <EncabezadoPagina
        titulo={c.nombre}
        descripcion={`Cliente desde ${new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: tz }).format(new Date(c.created_at))}`}
        volver={{ href: "/panel/clientes", texto: "Clientes" }}
        acciones={
          <>
            <a
              href={linkWhatsApp(c.telefono)}
              target="_blank"
              className="inline-flex h-9 items-center rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              WhatsApp
            </a>
            <BotonLink href="/panel/agenda?nuevo=1" tamano="sm">
              + Turno
            </BotonLink>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Numero titulo="Visitas" valor={String(atendidos.length)} />
        <Numero titulo="Gastado" valor={formatPrecio(gastado) ?? "$ 0"} />
        <Numero titulo="Cancelaciones" valor={String(canceladosCliente)} />
        <Numero titulo="Inasistencias" valor={String(ausencias.length)} />
      </div>

      {limitado ? (
        <Aviso tipo="alerta">
          <p>
            Por no asistir a 3 turnos, solo puede tener un turno reservado a la vez desde la página de reservas. Desde el
            panel le podés agendar los que quieras.
          </p>
          <BotonAccion className="mt-2" accion={quitarLimiteCliente.bind(null, c.id)} confirmar="Sí, quitar el límite" pendiente="Guardando…">
            Quitar límite
          </BotonAccion>
        </Aviso>
      ) : null}

      <Tarjeta>
        <h2 className="mb-4 font-bold">Datos</h2>
        <FormularioCliente cliente={c} />
      </Tarjeta>

      <Tarjeta>
        <h2 className="mb-3 font-bold">Historial</h2>
        {turnos.length === 0 ? (
          <p className="text-sm text-zinc-600">Todavía no tiene turnos.</p>
        ) : (
          <ul className="-mx-2 divide-y divide-zinc-100">
            {turnos.map((t) => (
              <li key={t.id}>
                <Link href={`/panel/turnos/${t.id}`} className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-zinc-50">
                  <div className="w-24 shrink-0 text-sm">
                    <p className="font-semibold first-letter:uppercase">{formatFechaCorta(t.inicio, tz)}</p>
                    <p className="text-zinc-500 tabular-nums">{formatHora(t.inicio, tz)} h</p>
                  </div>
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="truncate font-medium">{t.servicio?.nombre}</p>
                    <p className="truncate text-zinc-500">
                      {t.profesional?.nombre}
                      {t.precio !== null ? ` · ${formatPrecio(t.precio)}` : ""}
                    </p>
                  </div>
                  <Insignia color={COLOR[t.estado]}>{ESTADOS_TURNO[t.estado]}</Insignia>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>
    </div>
  );
}

function Numero({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <Tarjeta className="p-4">
      <p className="text-xs font-medium text-zinc-500 sm:text-sm">{titulo}</p>
      <p className="mt-0.5 truncate text-xl font-extrabold tabular-nums sm:text-2xl">{valor}</p>
    </Tarjeta>
  );
}
