import { Estrellas } from "@/components/estrellas";
import { cx } from "@/components/ui";
import type { ResenaPublica, ResumenResenas } from "@/lib/resenas";

export function formatPromedio(n: number) {
  return n.toFixed(1).replace(".", ",");
}

export function textoCantidad(n: number) {
  return `${n} ${n === 1 ? "opinión" : "opiniones"}`;
}

function mesYAnio(iso: string, tz: string) {
  return new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: tz }).format(new Date(iso));
}

/** Promedio grande y barras de 5 a 1 estrellas. */
export function ResumenOpiniones({ resumen }: { resumen: ResumenResenas }) {
  if (resumen.promedio === null) return null;
  const max = Math.max(...resumen.porEstrellas, 1);
  return (
    <div className="flex items-center gap-5 sm:gap-7">
      <div className="shrink-0 text-center">
        <p className="font-display text-5xl font-bold leading-none tabular-nums">{formatPromedio(resumen.promedio)}</p>
        <Estrellas valor={resumen.promedio} className="mt-2 size-4" />
        <p className="mt-1 text-xs text-zinc-500">{textoCantidad(resumen.cantidad)}</p>
      </div>
      <ul className="min-w-0 flex-1 space-y-1" aria-label="Opiniones por puntaje">
        {[5, 4, 3, 2, 1].map((e) => {
          const n = resumen.porEstrellas[e - 1];
          return (
            <li key={e} className="flex items-center gap-2 text-xs text-zinc-500">
              <span className="w-2 tabular-nums">{e}</span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100">
                <span className="block h-full rounded-full bg-amber-400" style={{ width: `${(n / max) * 100}%` }} />
              </span>
              <span className="w-6 text-right tabular-nums">{n}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ListaOpiniones({ resenas, negocio, tz }: { resenas: ResenaPublica[]; negocio: string; tz: string }) {
  return (
    <ul className="divide-y divide-zinc-100">
      {resenas.map((r) => (
        <li key={r.id} className="py-4 first:pt-0 last:pb-0">
          <div className="flex items-start gap-3">
            <span
              className="grid size-9 shrink-0 place-items-center rounded-full bg-marca-50 font-display text-sm font-bold text-marca-800"
              aria-hidden
            >
              {r.autor.charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="font-semibold text-tinta">{r.autor}</p>
                <p className="text-xs text-zinc-400 first-letter:uppercase">{mesYAnio(r.created_at, tz)}</p>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                <Estrellas valor={r.estrellas} className="size-3.5" />
                <span className="text-xs text-zinc-500">
                  {r.servicio} · con {r.profesional}
                </span>
              </div>
              {r.comentario ? (
                <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-zinc-700">{r.comentario}</p>
              ) : null}
              {r.respuesta ? (
                <div className={cx("mt-3 rounded-xl bg-zinc-50 px-3.5 py-2.5 text-sm ring-1 ring-zinc-100")}>
                  <p className="text-xs font-semibold text-zinc-500">Respuesta de {negocio}</p>
                  <p className="mt-0.5 whitespace-pre-line text-zinc-700">{r.respuesta}</p>
                </div>
              ) : null}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
