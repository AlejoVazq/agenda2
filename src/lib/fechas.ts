// Las fechas se guardan en UTC (timestamptz) y se muestran en la zona del negocio.
export const ZONA_AR = "America/Argentina/Buenos_Aires";
const LOCALE = "es-AR";

export function formatFechaLarga(iso: string | Date, tz = ZONA_AR) {
  return new Intl.DateTimeFormat(LOCALE, { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(
    new Date(iso),
  );
}

export function formatFechaCorta(iso: string | Date, tz = ZONA_AR) {
  return new Intl.DateTimeFormat(LOCALE, { weekday: "short", day: "numeric", month: "short", timeZone: tz }).format(
    new Date(iso),
  );
}

export function formatHora(iso: string | Date, tz = ZONA_AR) {
  return new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(
    new Date(iso),
  );
}

export function formatFechaHora(iso: string | Date, tz = ZONA_AR) {
  return `${formatFechaLarga(iso, tz)} · ${formatHora(iso, tz)} h`;
}

/** "YYYY-MM-DD" de un instante, en la zona indicada. */
export function fechaLocalISO(instante: Date | string = new Date(), tz = ZONA_AR) {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: tz }).format(
    new Date(instante),
  );
}

/** Suma días a una fecha "YYYY-MM-DD" (aritmética de calendario, sin zonas). */
export function sumarDias(fecha: string, dias: number) {
  const [a, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

/** Formatea una fecha "YYYY-MM-DD" sin desplazarla por zona horaria. */
export function formatFechaISO(fecha: string, opciones: Intl.DateTimeFormatOptions) {
  const [a, m, d] = fecha.split("-").map(Number);
  return new Intl.DateTimeFormat(LOCALE, { ...opciones, timeZone: "UTC" }).format(new Date(Date.UTC(a, m - 1, d)));
}

/** Offset de una zona horaria en un instante, como "-03:00". */
export function offsetZona(instante: Date, tz = ZONA_AR) {
  const partes = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(instante);
  const nombre = partes.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = nombre.match(/GMT([+-]\d{2}):?(\d{2})?/);
  return m ? `${m[1]}:${m[2] ?? "00"}` : "+00:00";
}

/** Convierte fecha y hora locales del negocio ("YYYY-MM-DD", "HH:MM") a un instante (UTC). */
export function localADate(fecha: string, hora: string, tz = ZONA_AR) {
  const aprox = new Date(`${fecha}T12:00:00Z`);
  return new Date(`${fecha}T${hora.slice(0, 5)}:00${offsetZona(aprox, tz)}`);
}

/** "YYYY-MM-DDTHH:MM" local (para inputs datetime-local) de un instante. */
export function localInputValue(instante: Date | string, tz = ZONA_AR) {
  return `${fechaLocalISO(instante, tz)}T${formatHora(instante, tz)}`;
}

export function formatPrecio(precio: number | string | null | undefined) {
  if (precio === null || precio === undefined || precio === "") return null;
  return new Intl.NumberFormat(LOCALE, { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(
    Number(precio),
  );
}

export function formatDuracion(min: number) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}
