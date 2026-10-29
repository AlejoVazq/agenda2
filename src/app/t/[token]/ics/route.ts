import { env } from "@/lib/env";
import { MARCA } from "@/lib/marca";
import { getTurnoPublico } from "@/lib/publico";

// Archivo .ics para agregar el turno a Apple Calendar, Outlook, etc.

function fechaIcs(iso: string) {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Escapa texto según RFC 5545. */
function texto(valor: string) {
  return valor.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

export async function GET(_request: Request, { params }: RouteContext<"/t/[token]/ics">) {
  const { token } = await params;
  const turno = await getTurnoPublico(token);
  if (!turno || turno.estado === "cancelado") return new Response("No encontrado", { status: 404 });

  const lineas = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${MARCA.nombre}//Turnos//ES`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${turno.id}@${new URL(env.siteUrl).hostname}`,
    `DTSTAMP:${fechaIcs(new Date().toISOString())}`,
    `DTSTART:${fechaIcs(turno.inicio)}`,
    `DTEND:${fechaIcs(turno.fin)}`,
    `SUMMARY:${texto(`${turno.servicio} - ${turno.negocio.nombre}`)}`,
    `DESCRIPTION:${texto(`Con ${turno.profesional}. Ver o cancelar: ${env.siteUrl}/t/${token}`)}`,
    ...(turno.negocio.direccion ? [`LOCATION:${texto(turno.negocio.direccion)}`] : []),
    "BEGIN:VALARM",
    "TRIGGER:-PT2H",
    "ACTION:DISPLAY",
    `DESCRIPTION:${texto(turno.servicio)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return new Response(lineas.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="turno.ics"',
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
