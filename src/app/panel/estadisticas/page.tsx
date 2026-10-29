import type { Metadata } from "next";
import Link from "next/link";
import { cx, EncabezadoPagina, Tarjeta, Vacio } from "@/components/ui";
import { requerirDueno } from "@/lib/auth";
import { fechaLocalISO, formatPrecio, localADate, sumarDias } from "@/lib/fechas";
import { crearSupabaseServidor } from "@/lib/supabase/server";
import { DIAS_SEMANA } from "@/lib/tipos";

export const metadata: Metadata = { title: "Estadísticas" };

type Estadisticas = {
  total: number;
  activos: number;
  cancelados: number;
  cancelados_cliente: number;
  online: number;
  ingresos: number;
  senas: number;
  clientes_nuevos: number;
  por_servicio: { nombre: string; cantidad: number; ingresos: number }[];
  por_profesional: { nombre: string; color: string; cantidad: number; ingresos: number }[];
  por_dia_semana: { dia: number; cantidad: number }[];
};

const PERIODOS = {
  mes: "Este mes",
  "mes-anterior": "Mes anterior",
  "30d": "Últimos 30 días",
  "90d": "Últimos 90 días",
} as const;
type Periodo = keyof typeof PERIODOS;

function rango(periodo: Periodo, tz: string): [Date, Date] {
  const hoy = fechaLocalISO(new Date(), tz);
  const primeroDelMes = `${hoy.slice(0, 8)}01`;
  switch (periodo) {
    case "mes": {
      const [a, m] = hoy.split("-").map(Number);
      const siguiente = new Date(Date.UTC(a, m, 1)).toISOString().slice(0, 10);
      return [localADate(primeroDelMes, "00:00", tz), localADate(siguiente, "00:00", tz)];
    }
    case "mes-anterior": {
      const [a, m] = hoy.split("-").map(Number);
      const anterior = new Date(Date.UTC(a, m - 2, 1)).toISOString().slice(0, 10);
      return [localADate(anterior, "00:00", tz), localADate(primeroDelMes, "00:00", tz)];
    }
    case "30d":
      return [localADate(sumarDias(hoy, -29), "00:00", tz), localADate(sumarDias(hoy, 1), "00:00", tz)];
    case "90d":
      return [localADate(sumarDias(hoy, -89), "00:00", tz), localADate(sumarDias(hoy, 1), "00:00", tz)];
  }
}

export default async function PaginaEstadisticas({ searchParams }: PageProps<"/panel/estadisticas">) {
  const { negocio } = await requerirDueno();
  const { periodo: p } = await searchParams;
  const periodo: Periodo = typeof p === "string" && p in PERIODOS ? (p as Periodo) : "mes";
  const [desde, hasta] = rango(periodo, negocio.zona_horaria);

  const supabase = await crearSupabaseServidor();
  const { data } = await supabase.rpc("estadisticas_negocio", { p_desde: desde.toISOString(), p_hasta: hasta.toISOString() });
  const e = data as Estadisticas | null;

  const tasaCancelacion = e && e.total ? Math.round((e.cancelados / e.total) * 100) : 0;
  const porcentajeOnline = e && e.total - e.cancelados ? Math.round((e.online / (e.total - e.cancelados)) * 100) : 0;

  return (
    <div className="max-w-5xl space-y-6">
      <EncabezadoPagina titulo="Estadísticas" descripcion="Cómo viene tu negocio. Incluye los turnos ya agendados del período." />

      <nav className="flex flex-wrap gap-2" aria-label="Período">
        {(Object.keys(PERIODOS) as Periodo[]).map((clave) => (
          <Link
            key={clave}
            href={`/panel/estadisticas?periodo=${clave}`}
            aria-current={clave === periodo ? "page" : undefined}
            className={cx(
              "rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors",
              clave === periodo
                ? "border-marca-700 bg-marca-700 text-white"
                : "border-zinc-200 bg-white text-zinc-700 hover:border-marca-300",
            )}
          >
            {PERIODOS[clave]}
          </Link>
        ))}
      </nav>

      {!e || e.total === 0 ? (
        <Vacio titulo="Sin turnos en este período" descripcion="Cuando haya reservas, vas a ver acá el resumen." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Dato titulo="Turnos" valor={String(e.total - e.cancelados)} detalle={`${e.total} reservados en total`} />
            <Dato titulo="Facturación estimada" valor={formatPrecio(e.ingresos) ?? "$ 0"} detalle="Confirmados y atendidos" />
            <Dato
              titulo="Cancelaciones"
              valor={`${tasaCancelacion}%`}
              detalle={`${e.cancelados} turnos · ${e.cancelados_cliente} por el cliente`}
            />
            <Dato titulo="Reservas online" valor={`${porcentajeOnline}%`} detalle={`${e.clientes_nuevos} clientes nuevos`} />
          </div>
          {Number(e.senas) > 0 ? (
            <p className="text-sm text-zinc-600">
              Señas cobradas por Mercado Pago en el período: <strong>{formatPrecio(e.senas)}</strong>
            </p>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <Tarjeta>
              <h2 className="mb-4 font-bold">Servicios más pedidos</h2>
              <Barras filas={e.por_servicio.slice(0, 8).map((s) => ({ etiqueta: s.nombre, valor: s.cantidad, detalle: formatPrecio(s.ingresos) }))} />
            </Tarjeta>
            <Tarjeta>
              <h2 className="mb-4 font-bold">Turnos por profesional</h2>
              <Barras
                filas={e.por_profesional.map((p) => ({
                  etiqueta: p.nombre,
                  valor: p.cantidad,
                  detalle: formatPrecio(p.ingresos),
                  color: p.color,
                }))}
              />
            </Tarjeta>
            <Tarjeta className="lg:col-span-2">
              <h2 className="mb-4 font-bold">Días con más turnos</h2>
              <Barras
                filas={[1, 2, 3, 4, 5, 6, 0].map((d) => ({
                  etiqueta: DIAS_SEMANA[d],
                  valor: e.por_dia_semana.find((x) => x.dia === d)?.cantidad ?? 0,
                }))}
              />
            </Tarjeta>
          </div>
        </>
      )}
    </div>
  );
}

function Dato({ titulo, valor, detalle }: { titulo: string; valor: string; detalle: string }) {
  return (
    <Tarjeta className="p-4 sm:p-5">
      <p className="text-sm font-medium text-zinc-600">{titulo}</p>
      <p className="mt-1 text-2xl font-extrabold tracking-tight tabular-nums text-tinta sm:text-3xl">{valor}</p>
      <p className="mt-1 text-xs text-zinc-500">{detalle}</p>
    </Tarjeta>
  );
}

/** Barras horizontales de una sola serie, con el valor siempre escrito. */
function Barras({ filas }: { filas: { etiqueta: string; valor: number; detalle?: string | null; color?: string }[] }) {
  const maximo = Math.max(1, ...filas.map((f) => f.valor));
  return (
    <ul className="space-y-3">
      {filas.map((f) => (
        <li key={f.etiqueta} title={`${f.etiqueta}: ${f.valor} turnos${f.detalle ? ` · ${f.detalle}` : ""}`}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2 truncate font-medium text-tinta">
              {f.color ? <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: f.color }} aria-hidden /> : null}
              {f.etiqueta}
            </span>
            <span className="shrink-0 tabular-nums text-zinc-600">
              {f.valor}
              {f.detalle ? <span className="text-zinc-400"> · {f.detalle}</span> : null}
            </span>
          </div>
          <div className="h-2 rounded-full bg-zinc-100">
            <div
              className="h-2 rounded-full bg-marca-600"
              style={{ width: `${(f.valor / maximo) * 100}%`, minWidth: f.valor ? "0.5rem" : 0 }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
