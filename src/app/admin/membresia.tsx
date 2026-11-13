import { cx } from "@/components/ui";
import { formatFechaCorta } from "@/lib/fechas";
import { calcularMembresia, diasHasta, EFECTO_ESTADO, pasosMembresia, type EstadoSuscripcion, type PeriodoPago } from "@/lib/suscripcion";
import { InsigniaEstado } from "./estado";

type Datos = {
  estado: EstadoSuscripcion;
  created_at: string;
  prueba_hasta: string;
  pagado_hasta: string | null;
  suspendido_at: string | null;
  suspension_motivo: string | null;
  pagos: PeriodoPago[];
};

/** En qué momento de la membresía está el negocio y qué le pasa en cada etapa. */
export function LineaMembresia({ n }: { n: Datos }) {
  const m = calcularMembresia(n);
  const pasos = pasosMembresia(n);

  const p = m.periodo;
  const resumen =
    n.estado === "suspendida"
      ? `Dado de baja el ${formatFechaCorta(n.suspendido_at!)}${n.suspension_motivo ? `: ${n.suspension_motivo}` : ""}.`
      : n.estado === "gracia"
        ? `Venció el ${formatFechaCorta(m.vence)} · se apaga en ${diasHasta(m.apagado)} ${diasHasta(m.apagado) === 1 ? "día" : "días"} (${formatFechaCorta(m.apagado)})`
        : n.estado === "vencida"
          ? `Apagado desde el ${formatFechaCorta(m.apagado)}`
          : p
            ? `Día ${p.dia} de ${p.total} ${p.tipo === "plan" ? "del plan" : "de la prueba"} · vence el ${formatFechaCorta(m.vence)} (${diasHasta(m.vence)} d)`
            : `Vence el ${formatFechaCorta(m.vence)} (${diasHasta(m.vence)} d)`;

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-zinc-50 p-3.5 ring-1 ring-zinc-200/70">
        <div className="flex flex-wrap items-center gap-2">
          <InsigniaEstado estado={n.estado} />
          <p className="text-sm font-semibold">{resumen}</p>
        </div>
        <p className="mt-1 text-sm text-zinc-600">{EFECTO_ESTADO[n.estado]}</p>
        {p && (n.estado === "prueba" || n.estado === "activa") ? (
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-200" role="progressbar" aria-valuemin={1} aria-valuemax={p.total} aria-valuenow={p.dia} aria-label="Avance del período">
            <div
              className={cx("h-full rounded-full", p.total - p.dia < 4 ? "bg-acento-500" : "bg-marca-600")}
              style={{ width: `${Math.round((p.dia / p.total) * 100)}%` }}
            />
          </div>
        ) : null}
      </div>

      <ol className={cx("relative space-y-3 border-l-2 border-zinc-200 pl-5", n.estado === "suspendida" && "opacity-50")}>
        {pasos.map((paso) => {
          const pasado = paso.momento === "pasado";
          const esActual = paso.momento === "ahora" && n.estado !== "suspendida";
          return (
            <li key={paso.titulo} className="relative">
              <span
                className={cx(
                  "absolute -left-[1.6rem] top-1 size-3 rounded-full ring-4 ring-white",
                  esActual ? "bg-acento-500" : pasado ? "bg-marca-600" : "bg-zinc-300",
                )}
                aria-hidden
              />
              <p className={cx("text-sm", esActual ? "font-bold" : "font-semibold", !pasado && !esActual && "text-zinc-500")}>
                {paso.titulo}
                {esActual ? <span className="ml-2 text-xs font-semibold text-acento-700">← ahora</span> : null}
              </p>
              <p className="text-xs text-zinc-500">
                {formatFechaCorta(paso.fecha)}
                {paso.hasta ? ` → ${formatFechaCorta(paso.hasta)}` : ""} · {paso.detalle}
              </p>
            </li>
          );
        })}
      </ol>
      {n.estado === "suspendida" ? (
        <p className="text-xs text-zinc-500">Mientras esté dado de baja, las fechas no cuentan: está apagado igual.</p>
      ) : null}
    </div>
  );
}
