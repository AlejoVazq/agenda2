import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { crearSupabaseAdmin } from "@/lib/supabase/admin";
import { enviarEmail } from "@/lib/email/enviar";
import { emailRecordatorio } from "@/lib/email/plantillas";

// Envía los recordatorios pendientes. Llamarlo cada hora desde un cron
// (Vercel Cron, GitHub Actions, cron-job.org, etc.) con el header
//   Authorization: Bearer <CRON_SECRET>
export const maxDuration = 60;

type Pendiente = {
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

function autorizado(request: NextRequest) {
  const secreto = process.env.CRON_SECRET;
  if (!secreto) return false;
  const recibido = Buffer.from(request.headers.get("authorization") ?? "");
  const esperado = Buffer.from(`Bearer ${secreto}`);
  return recibido.length === esperado.length && timingSafeEqual(recibido, esperado);
}

export async function GET(request: NextRequest) {
  if (!autorizado(request)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const admin = crearSupabaseAdmin();
  const { data, error } = await admin.rpc("reclamar_recordatorios", { p_limite: 100 });
  if (error) {
    console.error("[cron recordatorios]", error);
    return NextResponse.json({ error: "No se pudieron leer los turnos" }, { status: 500 });
  }

  const pendientes = (data ?? []) as Pendiente[];
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
    await admin.from("turnos").update({ recordatorio_enviado_at: null }).in("id", fallidos);
  }

  return NextResponse.json({ enviados: pendientes.length - fallidos.length, fallidos: fallidos.length });
}
