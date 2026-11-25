import "server-only";
import { env } from "@/lib/env";
import { formatFechaHora, formatFechaLarga, formatHora, formatPrecio } from "@/lib/fechas";
import { MARCA } from "@/lib/marca";
import { DIAS_GRACIA } from "@/lib/suscripcion";
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
<html lang="es"><body style="margin:0;background:#f3eee4;font-family:Arial,Helvetica,sans-serif;color:#14231c">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:20px;padding:28px">
        <tr><td>
          <p style="margin:0;font-size:13px;font-weight:bold;color:#1f4d3a">${escapar(d.negocio.nombre)}</p>
          <h1 style="margin:6px 0 8px;font-size:22px">${escapar(titulo)}</h1>
          <p style="margin:0 0 20px;font-size:15px;color:#5a544b">${escapar(intro)}</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;border-top:1px solid #eee">
            ${filas
              .map(
                ([k, v]) =>
                  `<tr><td style="padding:9px 0;color:#776f63;border-bottom:1px solid #eee;width:90px">${escapar(k)}</td><td style="padding:9px 0;font-weight:bold;border-bottom:1px solid #eee">${escapar(v)}</td></tr>`,
              )
              .join("")}
          </table>
          <p style="margin:24px 0 8px"><a href="${link}" style="display:inline-block;background:#1f4d3a;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:12px">${escapar(boton)}</a></p>
          <p style="margin:12px 0 0;font-size:12px;color:#776f63">${escapar(politica)}</p>
        </td></tr>
      </table>
      <p style="font-size:11px;color:#a59d94;margin-top:16px">Turnos online con ${escapar(MARCA.nombre)}</p>
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
    /** El cliente canceló desde su link (mismo mail, otro título). */
    cancelada?: boolean;
  },
): Email {
  const cuando = formatFechaHora(d.inicio, d.zona_horaria);
  const titulo = d.cancelada ? "Un cliente canceló su turno" : d.pendiente ? "Nueva reserva para confirmar" : "Nueva reserva online";
  const asunto = d.cancelada ? "Canceló" : d.pendiente ? "Reserva para confirmar" : "Nueva reserva";
  const link = `${env.siteUrl}/panel/turnos/${d.turnoId}`;
  const filas: [string, string][] = [
    ["Cliente", d.cliente],
    ["Celular", d.telefono],
    ["Servicio", d.servicio],
    ["Cuándo", cuando],
    ["Con", d.profesional],
  ];
  if (d.sena) filas.push(["Seña", `${formatPrecio(d.sena)} (pagada por Mercado Pago)`]);
  const nota = d.cancelada ? "El horario ya quedó libre en tu página de reservas." : null;
  const html = `<!doctype html><html lang="es"><body style="font-family:Arial,Helvetica,sans-serif;color:#14231c;background:#f3eee4;padding:24px 12px">
  <div style="max-width:480px;margin:auto;background:#fff;border-radius:20px;padding:24px">
    <p style="margin:0;font-size:13px;font-weight:bold;color:#1f4d3a">${escapar(d.negocio)}</p>
    <h1 style="margin:6px 0 16px;font-size:20px">${titulo}</h1>
    <table style="font-size:14px;width:100%">${filas
      .map(([k, v]) => `<tr><td style="padding:6px 0;color:#776f63;width:80px">${escapar(k)}</td><td style="padding:6px 0;font-weight:bold">${escapar(v)}</td></tr>`)
      .join("")}</table>${nota ? `
    <p style="margin:16px 0 0;font-size:14px;color:#776f63">${escapar(nota)}</p>` : ""}
    <p style="margin:20px 0 0"><a href="${link}" style="display:inline-block;background:#1f4d3a;color:#fff;text-decoration:none;font-weight:bold;padding:11px 18px;border-radius:12px">Ver en el panel</a></p>
  </div></body></html>`;
  return {
    para,
    asunto: `${asunto}: ${d.cliente}, ${cuando}`,
    html,
    texto: [`${d.negocio}: ${titulo.toLowerCase()}`, ...filas.map(([k, v]) => `${k}: ${v}`), ...(nota ? ["", nota] : []), "", link].join("\n"),
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

/** Unas horas después del turno: pide la opinión, con el link a la página del turno. */
export function emailPedidoResena(
  para: string,
  d: { token: string; cliente: string; servicio: string; profesional: string; negocio: string },
): Email {
  const link = `${env.siteUrl}/t/${d.token}#opinar`;
  const nombre = d.cliente.split(" ")[0] || "";
  const titulo = `¿Cómo te fue en ${d.negocio}?`;
  const intro = `Hola${nombre ? ` ${nombre}` : ""}, gracias por venir. ¿Nos contás cómo te fue con ${d.profesional} (${d.servicio})? Te lleva menos de un minuto y ayuda a otros clientes.`;
  const estrellas = [1, 2, 3, 4, 5]
    .map((n) => `<a href="${link}" style="text-decoration:none;font-size:30px;color:#f5b301;padding:0 2px" aria-label="${n}">★</a>`)
    .join("");
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f3eee4;font-family:Arial,Helvetica,sans-serif;color:#14231c">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:20px;padding:28px"><tr><td>
      <p style="margin:0;font-size:13px;font-weight:bold;color:#1f4d3a">${escapar(d.negocio)}</p>
      <h1 style="margin:6px 0 8px;font-size:22px">${escapar(titulo)}</h1>
      <p style="margin:0 0 16px;font-size:15px;color:#5a544b">${escapar(intro)}</p>
      <p style="margin:0 0 16px">${estrellas}</p>
      <p style="margin:0 0 8px"><a href="${link}" style="display:inline-block;background:#1f4d3a;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:12px">Dejar mi opinión</a></p>
      <p style="margin:16px 0 0;font-size:12px;color:#776f63">Se publica con tu nombre y la inicial del apellido. Podés opinar hasta 60 días después del turno.</p>
    </td></tr></table>
    <p style="font-size:11px;color:#a59d94;margin-top:16px">Turnos online con ${escapar(MARCA.nombre)}</p>
  </td></tr></table>
</body></html>`;
  const texto = [`${d.negocio} — ${titulo}`, intro, "", `Dejar mi opinión: ${link}`].join("\n");
  return { para, asunto: titulo, html, texto };
}

/** Mail simple con un botón: verificación de cuenta y recuperación de contraseña. */
function plantillaCuenta({ titulo, intro, boton, link, pie }: { titulo: string; intro: string; boton: string; link: string; pie: string }) {
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f3eee4;font-family:Arial,Helvetica,sans-serif;color:#14231c">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:20px;padding:28px"><tr><td>
      <p style="margin:0;font-size:13px;font-weight:bold;color:#1f4d3a">${escapar(MARCA.nombre)}</p>
      <h1 style="margin:6px 0 8px;font-size:22px">${escapar(titulo)}</h1>
      <p style="margin:0 0 20px;font-size:15px;color:#5a544b">${escapar(intro)}</p>
      <p style="margin:0 0 8px"><a href="${escapar(link)}" style="display:inline-block;background:#1f4d3a;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:12px">${escapar(boton)}</a></p>
      <p style="margin:16px 0 0;font-size:12px;color:#776f63">${escapar(pie)}</p>
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
            intro: `Hola ${nombre}, la prueba de ${a.negocio} termina el ${formatFechaLarga(a.vence)}. Para seguir usando el panel y tomando turnos online después, contratá el plan mensual.${contacto}`,
          }
        : {
            asunto: `Tu plan de ${MARCA.nombre} vence el ${formatFechaLarga(a.vence)}`,
            titulo: "Tu plan está por vencer",
            intro: `Hola ${nombre}, el plan de ${a.negocio} vence el ${formatFechaLarga(a.vence)}. Renovalo antes para seguir usando el panel con normalidad: si vence, queda en solo lectura y a los ${DIAS_GRACIA} días se apaga.${contacto}`,
          },
    vencio: {
      asunto: `Tu suscripción de ${MARCA.nombre} venció`,
      titulo: "Tu suscripción venció",
      intro: `Hola ${nombre}, la suscripción de ${a.negocio} venció: el panel quedó en solo lectura, pero tu página sigue tomando reservas${a.fin_servicio ? ` hasta el ${formatFechaLarga(a.fin_servicio)}` : ""}. Si no se renueva, ese día se apaga: no vas a poder entrar al panel y tu página deja de tomar turnos. Tus datos quedan guardados.${contacto}`,
    },
    bloqueado: {
      asunto: `${a.negocio} dejó de tomar reservas online`,
      titulo: "Tu cuenta se apagó",
      intro: `Hola ${nombre}, como la suscripción de ${a.negocio} no se renovó, la cuenta se apagó: tu página ya no toma reservas nuevas y no se puede entrar al panel. Los turnos que ya estaban reservados siguen en pie y todos tus datos quedan guardados: apenas renueves, vuelve todo como estaba.${contacto}`,
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

// --- Pedidos de la tienda -------------------------------------------------------------

export type DatosPedidoEmail = {
  pedidoId: string;
  token: string;
  numero: number;
  cliente: string;
  email: string;
  telefono: string | null;
  medio: "mercadopago" | "transferencia" | "efectivo";
  total: number;
  vence_at: string | null;
  /** Inicio del turno asociado (el cliente retira el día del turno). */
  turno_inicio: string | null;
  items: { nombre: string; precio_unitario: number; cantidad: number }[];
  negocio: {
    nombre: string;
    direccion: string | null;
    zona_horaria: string;
    transferencia_alias: string | null;
    transferencia_cbu: string | null;
    transferencia_titular: string | null;
  };
};

const NOMBRE_MEDIO = { mercadopago: "Mercado Pago", transferencia: "Transferencia", efectivo: "Efectivo en el local" } as const;

/** Mail de un pedido: items con subtotal, total, filas extra, párrafos y un botón. */
function plantillaPedido({
  d,
  titulo,
  intro,
  filas,
  parrafos,
  boton,
  link,
  pie,
}: {
  d: DatosPedidoEmail;
  titulo: string;
  intro: string;
  filas: [string, string][];
  parrafos: string[];
  boton: string;
  link: string;
  pie: string;
}) {
  const items = d.items.map((i) => [`${i.cantidad} × ${i.nombre}`, formatPrecio(i.precio_unitario * i.cantidad) ?? ""] as const);
  const celda = "padding:9px 0;border-bottom:1px solid #eee";
  const html = `<!doctype html>
<html lang="es"><body style="margin:0;background:#f3eee4;font-family:Arial,Helvetica,sans-serif;color:#14231c">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:20px;padding:28px">
        <tr><td>
          <p style="margin:0;font-size:13px;font-weight:bold;color:#1f4d3a">${escapar(d.negocio.nombre)}</p>
          <h1 style="margin:6px 0 8px;font-size:22px">${escapar(titulo)}</h1>
          <p style="margin:0 0 20px;font-size:15px;color:#5a544b">${escapar(intro)}</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;border-top:1px solid #eee">
            ${items
              .map(([k, v]) => `<tr><td style="${celda}">${escapar(k)}</td><td align="right" style="${celda};white-space:nowrap">${escapar(v)}</td></tr>`)
              .join("")}
            <tr><td style="${celda};font-weight:bold">Total</td><td align="right" style="${celda};font-weight:bold;white-space:nowrap">${escapar(formatPrecio(d.total) ?? "")}</td></tr>
          </table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin-top:12px">
            ${filas
              .map(
                ([k, v]) =>
                  `<tr><td style="padding:7px 0;color:#776f63;width:110px;vertical-align:top">${escapar(k)}</td><td style="padding:7px 0;font-weight:bold">${escapar(v)}</td></tr>`,
              )
              .join("")}
          </table>
          ${parrafos.map((p) => `<p style="margin:16px 0 0;font-size:14px;color:#5a544b">${escapar(p)}</p>`).join("")}
          <p style="margin:24px 0 8px"><a href="${link}" style="display:inline-block;background:#1f4d3a;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:12px">${escapar(boton)}</a></p>
          <p style="margin:12px 0 0;font-size:12px;color:#776f63">${escapar(pie)}</p>
        </td></tr>
      </table>
      <p style="font-size:11px;color:#a59d94;margin-top:16px">Turnos online con ${escapar(MARCA.nombre)}</p>
    </td></tr>
  </table>
</body></html>`;
  const texto = [
    `${d.negocio.nombre} — ${titulo}`,
    intro,
    "",
    ...items.map(([k, v]) => `${k}: ${v}`),
    `Total: ${formatPrecio(d.total)}`,
    "",
    ...filas.map(([k, v]) => `${k}: ${v}`),
    ...(parrafos.length ? ["", ...parrafos] : []),
    "",
    `${boton}: ${link}`,
    pie,
  ].join("\n");
  return { html, texto };
}

function hastaCuando(d: DatosPedidoEmail) {
  if (!d.vence_at) return null;
  const tz = d.negocio.zona_horaria;
  return `${formatFechaLarga(d.vence_at, tz)} a las ${formatHora(d.vence_at, tz)} h`;
}

/** Al cliente, apenas hace el pedido: link a /p/<token> e instrucciones según cómo paga. */
export function emailPedidoCliente(para: string, d: DatosPedidoEmail): Email {
  const nombre = d.cliente.split(" ")[0];
  const hasta = hastaCuando(d);
  const filas: [string, string][] = [["Pago", NOMBRE_MEDIO[d.medio]]];
  const parrafos: string[] = [];
  if (d.medio === "transferencia") {
    if (d.negocio.transferencia_alias) filas.push(["Alias", d.negocio.transferencia_alias]);
    if (d.negocio.transferencia_cbu) filas.push(["CBU/CVU", d.negocio.transferencia_cbu]);
    if (d.negocio.transferencia_titular) filas.push(["Titular", d.negocio.transferencia_titular]);
    filas.push(["Monto", formatPrecio(d.total) ?? ""]);
    parrafos.push(
      `Transferí ${formatPrecio(d.total)} y poné "Pedido #${d.numero}" en el concepto.${hasta ? ` Tenés tiempo hasta el ${hasta}; si no, el pedido se cancela solo.` : ""}`,
    );
  } else if (d.medio === "efectivo") {
    parrafos.push(
      d.turno_inicio
        ? `Lo pagás y lo retirás en el local el día de tu turno (${formatFechaLarga(d.turno_inicio, d.negocio.zona_horaria)}).`
        : `Lo pagás y lo retirás en el local${hasta ? ` hasta el ${hasta}` : ""}. Después de esa fecha el pedido se cancela solo.`,
    );
  } else {
    parrafos.push(
      `Si no terminaste de pagar, entrá al link para pagar con Mercado Pago${hasta ? ` (hasta el ${hasta})` : ""}. Te avisamos por mail cuando se acredite.`,
    );
  }
  if (d.negocio.direccion) filas.push(["Dónde retirás", d.negocio.direccion]);
  const { html, texto } = plantillaPedido({
    d,
    titulo: `Recibimos tu pedido #${d.numero}`,
    intro: `Hola ${nombre}, ${d.negocio.nombre} recibió tu pedido. Guardá este mail: desde el botón ves cómo pagarlo y podés cancelarlo mientras esté sin pagar.`,
    filas,
    parrafos,
    boton: "Ver mi pedido",
    link: `${env.siteUrl}/p/${d.token}`,
    pie: "Los productos se retiran en el local.",
  });
  return { para, asunto: `Pedido #${d.numero} en ${d.negocio.nombre}`, html, texto };
}

/** A los dueños: entró un pedido (transferencia o efectivo; los de Mercado Pago avisan al pagarse). */
export function emailPedidoNegocio(para: string, d: DatosPedidoEmail): Email {
  const hasta = hastaCuando(d);
  const filas: [string, string][] = [
    ["Cliente", d.cliente],
    ["Email", d.email],
  ];
  if (d.telefono) filas.push(["Celular", d.telefono]);
  filas.push(["Pago", NOMBRE_MEDIO[d.medio]]);
  if (d.turno_inicio) filas.push(["Retira", `el día de su turno (${formatFechaHora(d.turno_inicio, d.negocio.zona_horaria)})`]);
  else if (hasta) filas.push(["Plazo", `hasta el ${hasta}`]);
  const { html, texto } = plantillaPedido({
    d,
    titulo: `Nuevo pedido #${d.numero}`,
    intro:
      d.medio === "transferencia"
        ? `${d.cliente} hizo un pedido y va a pagar por transferencia. Cuando veas la plata, marcalo como "Pago recibido".`
        : `${d.cliente} hizo un pedido para pagar y retirar en el local. El stock ya quedó apartado.`,
    filas,
    parrafos: [],
    boton: "Ver en el panel",
    link: `${env.siteUrl}/panel/pedidos/${d.pedidoId}`,
    pie: `Recibís este mail porque sos dueño de ${d.negocio.nombre}.`,
  });
  return { para, asunto: `Nuevo pedido #${d.numero}: ${d.cliente}, ${formatPrecio(d.total)}`, html, texto };
}

/** Pago confirmado por Mercado Pago: al cliente (comprobante) o a los dueños (para preparar el pedido). */
export function emailPagoPedido(para: string, d: DatosPedidoEmail, destino: "cliente" | "negocio"): Email {
  if (destino === "cliente") {
    const filas: [string, string][] = [["Pago", "Mercado Pago (acreditado)"]];
    if (d.negocio.direccion) filas.push(["Dónde retirás", d.negocio.direccion]);
    const { html, texto } = plantillaPedido({
      d,
      titulo: `Pago confirmado: pedido #${d.numero}`,
      intro: `Hola ${d.cliente.split(" ")[0]}, recibimos el pago de tu pedido. Ya está apartado para que lo retires en el local${d.turno_inicio ? ` el día de tu turno (${formatFechaLarga(d.turno_inicio, d.negocio.zona_horaria)})` : ""}.`,
      filas,
      parrafos: [],
      boton: "Ver mi pedido",
      link: `${env.siteUrl}/p/${d.token}`,
      pie: "Los productos se retiran en el local.",
    });
    return { para, asunto: `Pago confirmado: pedido #${d.numero} en ${d.negocio.nombre}`, html, texto };
  }
  const filas: [string, string][] = [
    ["Cliente", d.cliente],
    ["Email", d.email],
  ];
  if (d.telefono) filas.push(["Celular", d.telefono]);
  filas.push(["Pago", "Mercado Pago (acreditado)"]);
  if (d.turno_inicio) filas.push(["Retira", `el día de su turno (${formatFechaHora(d.turno_inicio, d.negocio.zona_horaria)})`]);
  const { html, texto } = plantillaPedido({
    d,
    titulo: `Pago recibido: pedido #${d.numero}`,
    intro: `${d.cliente} pagó su pedido con Mercado Pago. Preparalo para cuando lo retire y marcalo como "Entregado".`,
    filas,
    parrafos: [],
    boton: "Ver en el panel",
    link: `${env.siteUrl}/panel/pedidos/${d.pedidoId}`,
    pie: `Recibís este mail porque sos dueño de ${d.negocio.nombre}.`,
  });
  return { para, asunto: `Pago recibido por Mercado Pago: pedido #${d.numero}, ${formatPrecio(d.total)}`, html, texto };
}

/** Al cliente: el negocio canceló su pedido (si ya lo había pagado, le avisa que se lo devuelven). */
export function emailPedidoCancelado(para: string, d: DatosPedidoEmail, pagado: boolean): Email {
  const { html, texto } = plantillaPedido({
    d,
    titulo: `Pedido #${d.numero} cancelado`,
    intro: `Hola ${d.cliente.split(" ")[0]}, ${d.negocio.nombre} canceló tu pedido.`,
    filas: [["Pago", NOMBRE_MEDIO[d.medio]]],
    parrafos: [
      pagado
        ? "Como ya lo habías pagado, el negocio se va a comunicar con vos para devolverte la plata."
        : "No tenés que pagar nada. Si tenés dudas, escribile al negocio.",
    ],
    boton: "Ver mi pedido",
    link: `${env.siteUrl}/p/${d.token}`,
    pie: "Si querés, podés hacer un pedido nuevo desde su página.",
  });
  return { para, asunto: `Pedido #${d.numero} cancelado en ${d.negocio.nombre}`, html, texto };
}
