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
    d.estado === "cancelado"
      ? ""
      : d.cancelacion_min_horas > 0
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
    `${d.estado === "cancelado" ? "Ver tu turno" : "Ver o cancelar tu turno"}: ${link}`,
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

export function emailCambioPorNegocio(para: string, d: DatosTurnoEmail, tipo: "cancelado" | "reprogramado" | "confirmado"): Email {
  const nombre = d.cliente.split(" ")[0];
  const { html, texto } = plantilla({
    titulo: tipo === "cancelado" ? "Tu turno fue cancelado" : tipo === "confirmado" ? "Tu turno está confirmado" : "Tu turno cambió de horario",
    intro:
      tipo === "cancelado"
        ? `Hola ${nombre}, ${d.negocio.nombre} canceló tu turno. Podés reservar otro cuando quieras.`
        : tipo === "confirmado"
          ? `Hola ${nombre}, ${d.negocio.nombre} confirmó tu turno. Te esperamos.`
          : `Hola ${nombre}, ${d.negocio.nombre} movió tu turno. Estos son los nuevos datos:`,
    d,
    boton: tipo === "cancelado" ? "Ver detalle" : "Ver mi turno",
  });
  return {
    para,
    asunto:
      tipo === "cancelado"
        ? `Turno cancelado: ${d.servicio} en ${d.negocio.nombre}`
        : tipo === "confirmado"
          ? `Turno confirmado: ${formatFechaHora(d.inicio, d.negocio.zona_horaria)} en ${d.negocio.nombre}`
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

/** Mail simple con un botón: verificación de cuenta y recuperación de contraseña. */
function plantillaCuenta({ titulo, intro, boton, link, pie }: { titulo: string; intro: string; boton: string; link: string; pie: string }) {
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f6f3ff;font-family:Arial,Helvetica,sans-serif;color:#1d1830">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:20px;padding:28px"><tr><td>
      <p style="margin:0;font-size:13px;font-weight:bold;color:#6322d6">${escapar(MARCA.nombre)}</p>
      <h1 style="margin:6px 0 8px;font-size:22px">${escapar(titulo)}</h1>
      <p style="margin:0 0 20px;font-size:15px;color:#52525b">${escapar(intro)}</p>
      <p style="margin:0 0 8px"><a href="${escapar(link)}" style="display:inline-block;background:#6322d6;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:12px">${escapar(boton)}</a></p>
      <p style="margin:16px 0 0;font-size:12px;color:#71717a">${escapar(pie)}</p>
    </td></tr></table>
  </td></tr></table>
</body></html>`;
  return { html, texto: [`${MARCA.nombre} — ${titulo}`, intro, "", `${boton}: ${link}`, "", pie].join("\n") };
}

export function emailVerificarCuenta(para: string, d: { nombre: string; url: string }): Email {
  const { html, texto } = plantillaCuenta({
    titulo: "Confirmá tu email",
    intro: `Hola ${d.nombre.split(" ")[0]}, abrí el link para confirmar tu cuenta y cargar tu negocio.`,
    boton: "Confirmar mi email",
    link: d.url,
    pie: "El link vence en 24 horas. Si no creaste una cuenta, ignorá este mail.",
  });
  return { para, asunto: `Confirmá tu email en ${MARCA.nombre}`, html, texto };
}

export function emailRestablecerPassword(para: string, d: { nombre: string; url: string }): Email {
  const { html, texto } = plantillaCuenta({
    titulo: "Elegí una contraseña nueva",
    intro: `Hola ${d.nombre.split(" ")[0]}, pediste cambiar tu contraseña. Abrí el link para elegir una nueva.`,
    boton: "Elegir contraseña",
    link: d.url,
    pie: "El link vence en 1 hora y se puede usar una sola vez. Si no lo pediste, ignorá este mail: tu contraseña no cambia.",
  });
  return { para, asunto: `Tu contraseña de ${MARCA.nombre}`, html, texto };
}

export type AvisoSuscripcion = {
  tipo: "por_vencer" | "vencio" | "bloqueado";
  /** Estado al momento del aviso: "prueba" o "activa" para por_vencer. */
  estado: string;
  negocio: string;
  nombre: string;
  vence: string;
  fin_servicio: string | null;
};

/** Avisos del vencimiento de la suscripción al dueño (los manda el cron). */
export function emailSuscripcion(para: string, a: AvisoSuscripcion): Email {
  const nombre = a.nombre.split(" ")[0];
  const contacto = env.contactoEmail ? ` Escribinos a ${env.contactoEmail}.` : "";
  const textos = {
    por_vencer:
      a.estado === "prueba"
        ? {
            asunto: `Tu prueba de ${MARCA.nombre} termina el ${formatFechaLarga(a.vence)}`,
            titulo: "Tu período de prueba está por terminar",
            intro: `Hola ${nombre}, la prueba de ${a.negocio} termina el ${formatFechaLarga(a.vence)}. Para seguir tomando turnos online después, contratá el plan mensual.${contacto}`,
          }
        : {
            asunto: `Tu plan de ${MARCA.nombre} vence el ${formatFechaLarga(a.vence)}`,
            titulo: "Tu plan está por vencer",
            intro: `Hola ${nombre}, el plan de ${a.negocio} vence el ${formatFechaLarga(a.vence)}. Renovalo para que tu página siga tomando reservas.${contacto}`,
          },
    vencio: {
      asunto: `Tu suscripción de ${MARCA.nombre} venció`,
      titulo: "Tu suscripción venció",
      intro: `Hola ${nombre}, la suscripción de ${a.negocio} venció, pero todo sigue funcionando${a.fin_servicio ? ` hasta el ${formatFechaLarga(a.fin_servicio)}` : ""}. Después, el panel queda en solo lectura y tu página deja de tomar reservas.${contacto}`,
    },
    bloqueado: {
      asunto: `${a.negocio} dejó de tomar reservas online`,
      titulo: "Tu página dejó de tomar reservas",
      intro: `Hola ${nombre}, como la suscripción de ${a.negocio} no se renovó, tu página ya no toma reservas nuevas y el panel quedó en solo lectura. Los turnos que ya estaban reservados siguen en pie. Para volver a activarla, renová el plan.${contacto}`,
    },
  }[a.tipo];
  const { html, texto } = plantillaCuenta({
    titulo: textos.titulo,
    intro: textos.intro,
    boton: "Ir a mi panel",
    link: `${env.siteUrl}/panel`,
    pie: `Recibís este mail porque sos el dueño de ${a.negocio} en ${MARCA.nombre}.`,
  });
  return { para, asunto: textos.asunto, html, texto, responderA: env.contactoEmail || null };
}

/** Google cortó el acceso al calendario (lo quitó el usuario o venció): hay que reconectar. */
export function emailGoogleDesconectado(para: string, d: { profesional: string; negocio: string }): Email {
  const { html, texto } = plantillaCuenta({
    titulo: "Se desconectó Google Calendar",
    intro: `Google cortó el acceso al calendario de ${d.profesional} en ${d.negocio}. Mientras tanto, los turnos nuevos no se copian a ese calendario y sus horarios ocupados no se tienen en cuenta al reservar. Para volver a conectarlo, entrá a Integraciones y tocá "Conectar".`,
    boton: "Ir a Integraciones",
    link: `${env.siteUrl}/panel/integraciones`,
    pie: "Suele pasar si se quitó el permiso desde la cuenta de Google o si se cambió la contraseña de esa cuenta.",
  });
  return { para, asunto: `Volvé a conectar Google Calendar de ${d.profesional}`, html, texto };
}
