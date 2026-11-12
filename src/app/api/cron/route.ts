import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { integracionesDisponibles } from "@/lib/env";
import { enviarEmail } from "@/lib/email/enviar";
import { emailRecordatorio, emailSuscripcion, type AvisoSuscripcion } from "@/lib/email/plantillas";
import { importarOcupadosTodos, sincronizarPendientes } from "@/lib/google";
import { comoServidor, sql } from "@/lib/db";
import { enviarPlantillaWhatsApp } from "@/lib/whatsapp-api";

// Tareas periódicas. Lo llama cada hora un timer de systemd en el servidor
// (deploy/agenda2-cron.timer) con el header
//   Authorization: Bearer <CRON_SECRET>
//
//  1. Libera turnos cuya seña no se pagó a tiempo.
//  2. Recordatorios por mail y por WhatsApp.
//  3. Google Calendar: reintenta sincronizaciones y trae horarios ocupados.
//  4. Avisa a los dueños que su suscripción está por vencer, venció o se bloqueó.
//  5. Limpia contadores viejos de límites de uso.
export const maxDuration = 300;

type PendienteMail = {
  turno_id: string;
  token: string;
  inicio: string;
  fin: string;
  cliente: string;
  email: string;
  servicio: string;
  profesional: string;
  negocio: string;
  slug: string;
  direccion: string | null;
  telefono: string | null;
  zona_horaria: string;
  cancelacion_min_horas: number;
};

type PendienteWhatsApp = {
  turno_id: string;
  token: string;
  inicio: string;
  cliente: string;
  telefono: string;
  servicio: string;
  negocio: string;
  zona_horaria: string;
};

function autorizado(request: NextRequest) {
  const secreto = process.env.CRON_SECRET;
  if (!secreto) return false;
  const recibido = Buffer.from(request.headers.get("authorization") ?? "");
  const esperado = Buffer.from(`Bearer ${secreto}`);
  return recibido.length === esperado.length && timingSafeEqual(recibido, esperado);
}

async function recordatoriosMail() {
  // Sin mail configurado no se reclaman: quedarían marcados como enviados.
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return { omitido: true };
  const pendientes = await comoServidor((tx) =>
    tx.varios<PendienteMail>(sql`select * from public.reclamar_recordatorios(100)`),
  );
  const fallidos: string[] = [];
  for (const p of pendientes) {
    const r = await enviarEmail(
      emailRecordatorio(p.email, {
        token: p.token,
        inicio: p.inicio,
        fin: p.fin,
        cliente: p.cliente,
        servicio: p.servicio,
        profesional: p.profesional,
        negocio: { nombre: p.negocio, direccion: p.direccion, telefono: p.telefono, zona_horaria: p.zona_horaria },
        cancelacion_min_horas: p.cancelacion_min_horas,
      }),
    );
    if (!r.ok) fallidos.push(p.turno_id);
  }
  // Los que fallaron se reintentan en la próxima corrida.
  if (fallidos.length) {
    await comoServidor((tx) =>
      tx.ejecutar(sql`update public.turnos set recordatorio_enviado_at = null where id = any(${fallidos}::uuid[])`),
    );
  }
  return { enviados: pendientes.length - fallidos.length, fallidos: fallidos.length };
}

async function recordatoriosWhatsApp() {
  if (!integracionesDisponibles().whatsapp || !process.env.WHATSAPP_PLANTILLA_RECORDATORIO) return { omitido: true };
  const pendientes = await comoServidor((tx) =>
    tx.varios<PendienteWhatsApp>(sql`select * from public.reclamar_recordatorios_whatsapp(100)`),
  );
  const fallidos: string[] = [];
  for (const p of pendientes) {
    const r = await enviarPlantillaWhatsApp("recordatorio", {
      telefono: p.telefono,
      cliente: p.cliente,
      negocio: p.negocio,
      servicio: p.servicio,
      inicio: p.inicio,
      zona_horaria: p.zona_horaria,
      token: p.token,
    });
    if (!r.ok) fallidos.push(p.turno_id);
  }
  if (fallidos.length) {
    await comoServidor((tx) =>
      tx.ejecutar(sql`update public.turnos set recordatorio_wa_enviado_at = null where id = any(${fallidos}::uuid[])`),
    );
  }
  return { enviados: pendientes.length - fallidos.length, fallidos: fallidos.length };
}

async function avisosSuscripcion() {
  // Sin mail configurado no se reclaman: quedarían marcados como enviados.
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return { omitido: true };
  const avisos = await comoServidor((tx) =>
    tx.varios<Omit<AvisoSuscripcion, "negocio"> & { negocio_id: string; nombre: string; dueno_nombre: string; dueno_email: string }>(
      sql`select * from plataforma.reclamar_avisos_suscripcion()`,
    ),
  );
  let fallidos = 0;
  for (const a of avisos) {
    const r = await enviarEmail(
      emailSuscripcion(a.dueno_email, {
        tipo: a.tipo,
        estado: a.estado,
        negocio: a.nombre,
        nombre: a.dueno_nombre,
        vence: a.vence,
        fin_servicio: a.fin_servicio,
      }),
    );
    if (r.ok) continue;
    fallidos++;
    // Se reintenta en la próxima corrida.
    await comoServidor((tx) =>
      tx.ejecutar(sql`
        delete from plataforma.avisos_suscripcion
        where negocio_id = ${a.negocio_id} and tipo = ${a.tipo} and vence = ${a.vence}::timestamptz`),
    );
  }
  return { enviados: avisos.length - fallidos, fallidos };
}

/** Corre una tarea sin que su error frene a las demás. */
async function tarea<T>(nombre: string, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (e) {
    console.error(`[cron] ${nombre}`, e);
    return { error: true };
  }
}

export async function GET(request: NextRequest) {
  if (!autorizado(request)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const google = integracionesDisponibles().google;

  const resultado = {
    senasVencidas: await tarea("señas", async () =>
      (await comoServidor((tx) => tx.uno<{ n: number }>(sql`select public.vencer_pagos_pendientes() as n`)))?.n ?? 0,
    ),
    mail: await tarea("recordatorios mail", recordatoriosMail),
    whatsapp: await tarea("recordatorios whatsapp", recordatoriosWhatsApp),
    suscripciones: await tarea("avisos de suscripción", avisosSuscripcion),
    googleOcupados: google ? await tarea("google ocupados", importarOcupadosTodos) : { omitido: true },
    googleTurnos: google ? await tarea("google turnos", () => sincronizarPendientes(100)) : { omitido: true },
    limpieza: await tarea("limpieza", async () => {
      await comoServidor(async (tx) => {
        await tx.ejecutar(sql`delete from public.limites_uso where ventana < now() - interval '1 day'`);
        // Links del equipo vencidos o usados hace más de una semana.
        await tx.ejecutar(sql`
          delete from public.accesos
          where expira_at < now() - interval '7 days' or usado_at < now() - interval '7 days'`);
      });
      return true;
    }),
  };

  return NextResponse.json(resultado);
}
