import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { BotonLink, EncabezadoPagina, Insignia, Tarjeta } from "@/components/ui";
import { requerirDueno } from "@/lib/auth";
import { formatFechaCorta, formatHora, formatPrecio } from "@/lib/fechas";
import { crearSupabaseServidor } from "@/lib/supabase/server";
import { ESTADOS_TURNO, type Cliente, type EstadoTurno } from "@/lib/tipos";
import { linkWhatsApp } from "@/lib/whatsapp";
import { FormularioCliente } from "./formulario";

export const metadata: Metadata = { title: "Cliente" };

const COLOR = { pendiente: "ambar", confirmado: "verde", cancelado: "rojo", completado: "gris" } as const;

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
  const { negocio } = await requerirDueno();
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await crearSupabaseServidor();
  const [{ data: cliente }, { data: filas }] = await Promise.all([
    supabase.from("clientes").select("id, nombre, telefono, email, notas, created_at").eq("id", id).maybeSingle(),
    supabase
      .from("turnos")
      .select("id, inicio, estado, precio, cancelado_por, servicio:servicios(nombre), profesional:profesionales(nombre)")
      .eq("cliente_id", id)
      .order("inicio", { ascending: false })
      .limit(100),
  ]);
  if (!cliente) notFound();
  const c = cliente as Cliente & { created_at: string };
  const turnos = (filas ?? []) as unknown as TurnoCliente[];
  const tz = negocio.zona_horaria;

  const ahora = new Date().toISOString();
  const atendidos = turnos.filter((t) => t.estado === "completado" || (t.estado === "confirmado" && t.inicio < ahora));
  const canceladosCliente = turnos.filter((t) => t.estado === "cancelado" && t.cancelado_por === "cliente").length;
  const gastado = atendidos.reduce((total, t) => total + Number(t.precio ?? 0), 0);

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

      <div className="grid grid-cols-3 gap-3">
        <Numero titulo="Visitas" valor={String(atendidos.length)} />
        <Numero titulo="Gastado" valor={formatPrecio(gastado) ?? "$ 0"} />
        <Numero titulo="Cancelaciones" valor={String(canceladosCliente)} />
      </div>

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
                    <p className="font-semibold capitalize">{formatFechaCorta(t.inicio, tz)}</p>
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
