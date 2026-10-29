import "server-only";
import { env } from "@/lib/env";
import { formatFechaHora, formatFechaLarga, formatHora, formatPrecio } from "@/lib/fechas";
import { MARCA } from "@/lib/marca";
import type { Email } from "./enviar";

export type DatosTurnoEmail = {
  token: string;
  inicio: string;
  fin: string;
  cliente: string;
  servicio: string;
  profesional: string;
  precio?: number | null;
  estado?: string;
  /** Seña ya cobrada (si hubo). */
  sena?: number | null;
  negocio: { nombre: string; direccion: string | null; telefono: string | null; zona_horaria: string };
  cancelacion_min_horas: number;
};

function escapar(texto: string) {
  return texto.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function plantilla({ titulo, intro, d, boton }: { titulo: string; intro: string; d: DatosTurnoEmail; boton: string }) {
  const tz = d.negocio.zona_horaria;
  const link = `${env.siteUrl}/t/${d.token}`;
  const filas: [string, string][] = [
    ["Servicio", d.servicio],
    ["Día", formatFechaLarga(d.inicio, tz)],
    ["Horario", `${formatHora(d.inicio, tz)} a ${formatHora(d.fin, tz)} h`],
    ["Con", d.profesional],
  ];
  if (d.precio !== null && d.precio !== undefined) filas.push(["Precio", formatPrecio(d.precio) ?? ""]);
  if (d.sena) filas.push(["Seña abonada", formatPrecio(d.sena) ?? ""]);
  if (d.negocio.direccion) filas.push(["Dónde", d.negocio.direccion]);

  const politica =
    d.cancelacion_min_horas > 0
      ? `Podés cancelar online hasta ${d.cancelacion_min_horas} ${d.cancelacion_min_horas === 1 ? "hora" : "horas"} antes del turno.`
      : "Podés cancelar online hasta el momento del turno.";

  const html = `<!doctype html>
<html lang="es"><body style="margin:0;background:#f6f3ff;font-family:Arial,Helvetica,sans-serif;color:#1d1830">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:20px;padding:28px">
        <tr><td>
          <p style="margin:0;font-size:13px;font-weight:bold;color:#6322d6">${escapar(d.negocio.nombre)}</p>
          <h1 style="margin:6px 0 8px;font-size:22px">${escapar(titulo)}</h1>
          <p style="margin:0 0 20px;font-size:15px;color:#52525b">${escapar(intro)}</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;border-top:1px solid #eee">
            ${filas
              .map(
                ([k, v]) =>
                  `<tr><td style="padding:9px 0;color:#71717a;border-bottom:1px solid #eee;width:90px">${escapar(k)}</td><td style="padding:9px 0;font-weight:bold;border-bottom:1px solid #eee">${escapar(v)}</td></tr>`,
              )
              .join("")}
          </table>
          <p style="margin:24px 0 8px"><a href="${link}" style="display:inline-block;background:#6322d6;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:12px">${escapar(boton)}</a></p>
          <p style="margin:12px 0 0;font-size:12px;color:#71717a">${escapar(politica)}</p>
        </td></tr>
      </table>
      <p style="font-size:11px;color:#a1a1aa;margin-top:16px">Turnos online con ${escapar(MARCA.nombre)}</p>
    </td></tr>
  </table>
</body></html>`;

  const texto = [
    `${d.negocio.nombre} — ${titulo}`,
    intro,
    "",
    ...filas.map(([k, v]) => `${k}: ${v}`),
    "",
    `Ver o cancelar tu turno: ${link}`,
    politica,
  ].join("\n");

  return { html, texto };
}

export function emailConfirmacion(para: string, d: DatosTurnoEmail): Email {
  const pendiente = d.estado === "pendiente";
  const { html, texto } = plantilla({
    titulo: pendiente ? "Recibimos tu reserva" : "¡Tu turno está reservado!",
    intro: pendiente
      ? `Hola ${d.cliente.split(" ")[0]}, el negocio tiene que confirmar tu reserva. Te avisarán.`
      : `Hola ${d.cliente.split(" ")[0]}, te esperamos. Guardá este mail: desde el botón podés ver o cancelar tu turno.`,
    d,
    boton: "Ver mi turno",
  });
  return {
    para,
    asunto: `${pendiente ? "Reserva recibida" : "Turno confirmado"}: ${formatFechaHora(d.inicio, d.negocio.zona_horaria)}`,
    html,
    texto,
  };
}

export function emailCambioPorNegocio(para: string, d: DatosTurnoEmail, tipo: "cancelado" | "reprogramado"): Email {
  const nombre = d.cliente.split(" ")[0];
  const { html, texto } = plantilla({
    titulo: tipo === "cancelado" ? "Tu turno fue cancelado" : "Tu turno cambió de horario",
    intro:
      tipo === "cancelado"
        ? `Hola ${nombre}, ${d.negocio.nombre} canceló tu turno. Podés reservar otro cuando quieras.`
        : `Hola ${nombre}, ${d.negocio.nombre} movió tu turno. Estos son los nuevos datos:`,
    d,
    boton: tipo === "cancelado" ? "Ver detalle" : "Ver mi turno",
  });
  return {
    para,
    asunto:
      tipo === "cancelado"
        ? `Turno cancelado: ${d.servicio} en ${d.negocio.nombre}`
        : `Nuevo horario: ${formatFechaHora(d.inicio, d.negocio.zona_horaria)} en ${d.negocio.nombre}`,
    html,
    texto,
  };
}

export function emailNuevaReserva(
  para: string,
  d: {
    turnoId: string;
    inicio: string;
    cliente: string;
    telefono: string;
    servicio: string;
    profesional: string;
    pendiente: boolean;
    negocio: string;
    zona_horaria: string;
    sena?: number | null;
  },
): Email {
  const cuando = formatFechaHora(d.inicio, d.zona_horaria);
  const link = `${env.siteUrl}/panel/turnos/${d.turnoId}`;
  const filas: [string, string][] = [
    ["Cliente", d.cliente],
    ["Celular", d.telefono],
    ["Servicio", d.servicio],
    ["Cuándo", cuando],
    ["Con", d.profesional],
  ];
  if (d.sena) filas.push(["Seña", `${formatPrecio(d.sena)} (pagada por Mercado Pago)`]);
  const html = `<!doctype html><html lang="es"><body style="font-family:Arial,Helvetica,sans-serif;color:#1d1830;background:#f6f3ff;padding:24px 12px">
  <div style="max-width:480px;margin:auto;background:#fff;border-radius:20px;padding:24px">
    <p style="margin:0;font-size:13px;font-weight:bold;color:#6322d6">${escapar(d.negocio)}</p>
    <h1 style="margin:6px 0 16px;font-size:20px">${d.pendiente ? "Nueva reserva para confirmar" : "Nueva reserva online"}</h1>
    <table style="font-size:14px;width:100%">${filas
      .map(([k, v]) => `<tr><td style="padding:6px 0;color:#71717a;width:80px">${escapar(k)}</td><td style="padding:6px 0;font-weight:bold">${escapar(v)}</td></tr>`)
      .join("")}</table>
    <p style="margin:20px 0 0"><a href="${link}" style="display:inline-block;background:#6322d6;color:#fff;text-decoration:none;font-weight:bold;padding:11px 18px;border-radius:12px">Ver en el panel</a></p>
  </div></body></html>`;
  return {
    para,
    asunto: `${d.pendiente ? "Reserva para confirmar" : "Nueva reserva"}: ${d.cliente}, ${cuando}`,
    html,
    texto: [`${d.negocio}: nueva reserva`, ...filas.map(([k, v]) => `${k}: ${v}`), "", link].join("\n"),
  };
}

export function emailRecordatorio(para: string, d: DatosTurnoEmail): Email {
  const { html, texto } = plantilla({
    titulo: "Te recordamos tu turno",
    intro: `Hola ${d.cliente.split(" ")[0]}, te esperamos. Si no podés venir, cancelalo así otra persona puede usar el horario.`,
    d,
    boton: "Ver o cancelar mi turno",
  });
  return {
    para,
    asunto: `Recordatorio: ${d.servicio} en ${d.negocio.nombre}, ${formatFechaHora(d.inicio, d.negocio.zona_horaria)}`,
    html,
    texto,
  };
}
