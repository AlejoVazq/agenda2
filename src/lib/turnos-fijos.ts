import "server-only";
import { sql } from "@/lib/db";
import { formatFechaISO } from "@/lib/fechas";

/** Regla de un turno fijo, como la leen las páginas del panel (fechas en texto). */
export type TurnoFijo = {
  id: string;
  /** Primera fecha, "YYYY-MM-DD": de ahí sale el día de la semana. */
  desde: string;
  /** "HH:MM", hora local del negocio. */
  hora: string;
  cada_semanas: 1 | 2;
  /** Fechas por venir que no se pudieron agendar (ocupado o ausencia). */
  fechas_salteadas: string[];
};

/** "Todos los lunes a las 21:00 h" o "Cada 2 semanas, los lunes a las 21:00 h". */
export function describirTurnoFijo(f: Pick<TurnoFijo, "desde" | "hora" | "cada_semanas">) {
  const dia = formatFechaISO(f.desde, { weekday: "long" });
  const plural = dia.endsWith("s") ? dia : `${dia}s`;
  return f.cada_semanas === 1 ? `Todos los ${plural} a las ${f.hora} h` : `Cada 2 semanas, los ${plural} a las ${f.hora} h`;
}

/** "25/11", "25/11 y 9/12", "25/11, 2/12 y 9/12". */
export function listarFechas(fechas: string[]) {
  const cortas = fechas.map((f) => formatFechaISO(f, { day: "numeric", month: "numeric" }));
  return cortas.length > 1 ? `${cortas.slice(0, -1).join(", ")} y ${cortas.at(-1)}` : (cortas[0] ?? "");
}

/** Columnas de turnos_fijos con las fechas ya en texto. */
export const COLUMNAS_TURNO_FIJO = sql`
  f.id, f.desde::text as desde, to_char(f.hora, 'HH24:MI') as hora, f.cada_semanas,
  array(
    select d::text from unnest(f.fechas_salteadas) d
    where d >= (now() at time zone 'America/Argentina/Buenos_Aires')::date order by d
  ) as fechas_salteadas`;
