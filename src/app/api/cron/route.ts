import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { integracionesDisponibles } from "@/lib/env";
import { enviarEmail } from "@/lib/email/enviar";
import { emailRecordatorio } from "@/lib/email/plantillas";
import { importarOcupadosTodos, sincronizarPendientes } from "@/lib/google";
import { crearSupabaseAdmin } from "@/lib/supabase/admin";
import { enviarPlantillaWhatsApp } from "@/lib/whatsapp-api";

// Tareas periódicas. Llamarlo cada hora desde un cron (Vercel Cron, GitHub
// Actions, cron-job.org, etc.) con el header
//   Authorization: Bearer <CRON_SECRET>
//
//  1. Libera turnos cuya seña no se pagó a tiempo.
//  2. Recordatorios por mail y por WhatsApp.
//  3. Google Calendar: reintenta sincronizaciones y trae horarios ocupados.
//  4. Limpia contadores viejos de límites de uso.
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
  const admin = crearSupabaseAdmin();
  const { data, error } = await admin.rpc("reclamar_recordatorios", { p_limite: 100 });
  if (error) throw error;
  const pendientes = (data ?? []) as PendienteMail[];
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
  if (fallidos.length) await admin.from("turnos").update({ recordatorio_enviado_at: null }).in("id", fallidos);
  return { enviados: pendientes.length - fallidos.length, fallidos: fallidos.length };
}

async function recordatoriosWhatsApp() {
  if (!integracionesDisponibles().whatsapp || !process.env.WHATSAPP_PLANTILLA_RECORDATORIO) return { omitido: true };
  const admin = crearSupabaseAdmin();
  const { data, error } = await admin.rpc("reclamar_recordatorios_whatsapp", { p_limite: 100 });
  if (error) throw error;
  const pendientes = (data ?? []) as PendienteWhatsApp[];
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
  if (fallidos.length) await admin.from("turnos").update({ recordatorio_wa_enviado_at: null }).in("id", fallidos);
  return { enviados: pendientes.length - fallidos.length, fallidos: fallidos.length };
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
  const admin = crearSupabaseAdmin();
  const google = integracionesDisponibles().google;

  const resultado = {
    senasVencidas: await tarea("señas", async () => (await admin.rpc("vencer_pagos_pendientes")).data),
    mail: await tarea("recordatorios mail", recordatoriosMail),
    whatsapp: await tarea("recordatorios whatsapp", recordatoriosWhatsApp),
    googleOcupados: google ? await tarea("google ocupados", importarOcupadosTodos) : { omitido: true },
    googleTurnos: google ? await tarea("google turnos", () => sincronizarPendientes(100)) : { omitido: true },
    limpieza: await tarea("limpieza", async () => {
      const limite = new Date(Date.now() - 86_400_000).toISOString();
      await admin.from("limites_uso").delete().lt("ventana", limite);
      return true;
    }),
  };

  return NextResponse.json(resultado);
}
