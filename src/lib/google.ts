import "server-only";
import { after } from "next/server";
import { env, integracionesDisponibles } from "@/lib/env";
import { fechaLocalISO, localADate, sumarDias } from "@/lib/fechas";
import { actualizarIntegracion, borrarIntegracion, leerSecreto, type Integracion } from "@/lib/integraciones";
import { MARCA } from "@/lib/marca";
import { crearSupabaseAdmin } from "@/lib/supabase/admin";
import { ESTADOS_TURNO, type EstadoTurno } from "@/lib/tipos";

// Fase 5: Google Calendar, una cuenta por profesional.
//  - Agenda2 -> Google: cada turno activo es un evento en el calendario del
//    profesional (se crea, mueve y borra solo). Ver sincronizarTurno().
//  - Google -> Agenda2 (opcional): lo que el profesional tiene ocupado en Google
//    se importa como ausencia para no ofrecer esos horarios. Ver importarOcupados().

const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.events"];
const API = "https://www.googleapis.com/calendar/v3";

export type ConfigGoogle = {
  email: string;
  calendario: string;
  importar_ocupado: boolean;
  ultima_sync?: string | null;
  ultimo_error?: string | null;
};
type SecretoGoogle = { refresh_token: string };

// --- OAuth ------------------------------------------------------------------------

export function urlRedireccionGoogle() {
  return `${env.siteUrl}/api/google/callback`;
}

export function urlAutorizacionGoogle(state: string, loginHint?: string | null) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID ?? "");
  url.searchParams.set("redirect_uri", urlRedireccionGoogle());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  // "consent" asegura que Google devuelva un refresh_token aunque ya se haya autorizado antes.
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  if (loginHint) url.searchParams.set("login_hint", loginHint);
  return url.toString();
}

async function pedirToken(parametros: Record<string, string>) {
  const respuesta = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      ...parametros,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const cuerpo = (await respuesta.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
  };
  return { ok: respuesta.ok, ...cuerpo };
}

/** Canjea el código del callback por tokens y averigua el email de la cuenta. */
export async function canjearCodigoGoogle(codigo: string) {
  const t = await pedirToken({ code: codigo, grant_type: "authorization_code", redirect_uri: urlRedireccionGoogle() });
  if (!t.ok || !t.access_token) throw new Error(`Google rechazó el código (${t.error ?? "sin detalle"}).`);
  if (!t.refresh_token) throw new Error("Google no devolvió un permiso permanente. Probá conectar de nuevo.");
  if (!t.scope?.includes("calendar.events")) {
    throw new Error("Hace falta permitir el acceso al calendario para conectar la cuenta.");
  }

  const info = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${t.access_token}` },
    signal: AbortSignal.timeout(10_000),
  });
  const { email } = (await info.json().catch(() => ({}))) as { email?: string };
  return { refreshToken: t.refresh_token, accessToken: t.access_token, email: email ?? "cuenta de Google" };
}

// --- Acceso a la API por profesional ------------------------------------------------

const cacheTokens = new Map<string, { token: string; vence: number }>();

type Acceso = { token: string; integracion: Integracion<ConfigGoogle> };

async function accesoProfesional(profesionalId: string): Promise<Acceso | null> {
  const admin = crearSupabaseAdmin();
  const { data } = await admin
    .from("integraciones")
    .select("*")
    .eq("proveedor", "google_calendar")
    .eq("profesional_id", profesionalId)
    .eq("estado", "activa")
    .maybeSingle();
  const integracion = data as Integracion<ConfigGoogle> | null;
  if (!integracion) return null;

  const enCache = cacheTokens.get(integracion.id);
  if (enCache && enCache.vence > Date.now() + 60_000) return { token: enCache.token, integracion };

  const secreto = await leerSecreto<SecretoGoogle>(integracion.id);
  if (!secreto) return null;
  const t = await pedirToken({ refresh_token: secreto.refresh_token, grant_type: "refresh_token" });
  if (!t.ok || !t.access_token) {
    if (t.error === "invalid_grant") {
      // El usuario quitó el permiso desde su cuenta de Google (o venció).
      await actualizarIntegracion(integracion, {
        estado: "error",
        config: { ultimo_error: "Google revocó el acceso. Volvé a conectar la cuenta." },
      });
    }
    return null;
  }
  cacheTokens.set(integracion.id, { token: t.access_token, vence: Date.now() + (t.expires_in ?? 3600) * 1000 });
  return { token: t.access_token, integracion };
}

function api(token: string, metodo: string, ruta: string, cuerpo?: unknown) {
  return fetch(`${API}${ruta}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, ...(cuerpo ? { "Content-Type": "application/json" } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
}

/** Id de evento estable por turno (Google acepta [a-v0-9], 5 a 1024 caracteres). */
function idEvento(turnoId: string) {
  return `tn${turnoId.replace(/-/g, "")}`;
}

const cal = (a: Acceso) => encodeURIComponent(a.integracion.config.calendario || "primary");

// --- Agenda2 -> Google -------------------------------------------------------------

type TurnoParaGoogle = {
  id: string;
  estado: EstadoTurno;
  inicio: string;
  fin: string;
  notas: string | null;
  updated_at: string;
  profesional_id: string;
  google_event_id: string | null;
  google_calendar_prof_id: string | null;
  pago_estado: string | null;
  servicio: { nombre: string } | null;
  cliente: { nombre: string; telefono: string; email: string | null } | null;
  negocio: { nombre: string; direccion: string | null; zona_horaria: string } | null;
};

function cuerpoEvento(t: TurnoParaGoogle) {
  const tz = t.negocio?.zona_horaria ?? "America/Argentina/Buenos_Aires";
  const pendiente = t.estado === "pendiente";
  const descripcion = [
    `Cliente: ${t.cliente?.nombre ?? ""}`,
    t.cliente?.telefono ? `Teléfono: +${t.cliente.telefono}` : null,
    t.cliente?.email ? `Email: ${t.cliente.email}` : null,
    `Estado: ${ESTADOS_TURNO[t.estado]}${t.pago_estado === "pendiente" ? " (esperando la seña)" : ""}`,
    t.notas ? `Notas: ${t.notas}` : null,
    "",
    `Ver en ${MARCA.nombre}: ${env.siteUrl}/panel/turnos/${t.id}`,
  ]
    .filter((l) => l !== null)
    .join("\n");

  return {
    summary: `${t.servicio?.nombre ?? "Turno"} · ${t.cliente?.nombre ?? ""}${pendiente ? " (a confirmar)" : ""}`,
    description: descripcion,
    location: t.negocio?.direccion ?? undefined,
    start: { dateTime: new Date(t.inicio).toISOString(), timeZone: tz },
    end: { dateTime: new Date(t.fin).toISOString(), timeZone: tz },
    status: "confirmed",
    extendedProperties: { private: { turniaTurnoId: t.id } },
    source: { title: MARCA.nombre, url: `${env.siteUrl}/panel/turnos/${t.id}` },
  };
}

async function errorDeApi(r: Response, accion: string) {
  const detalle = await r.text().catch(() => "");
  return new Error(`Google Calendar (${accion}) respondió ${r.status}: ${detalle.slice(0, 200)}`);
}

/**
 * Refleja en Google el estado actual de un turno: lo crea/actualiza si está
 * activo, lo borra si se canceló, y lo pasa de calendario si cambió de profesional.
 */
export async function sincronizarTurno(turnoId: string) {
  const admin = crearSupabaseAdmin();
  const { data } = await admin
    .from("turnos")
    .select(
      "id, estado, inicio, fin, notas, updated_at, profesional_id, google_event_id, google_calendar_prof_id, pago_estado, servicio:servicios(nombre), cliente:clientes(nombre, telefono, email), negocio:negocios(nombre, direccion, zona_horaria)",
    )
    .eq("id", turnoId)
    .maybeSingle();
  const t = data as unknown as TurnoParaGoogle | null;
  if (!t) return;

  const activo = t.estado === "pendiente" || t.estado === "confirmado" || t.estado === "completado" || t.estado === "ausente";
  let eventoId = t.google_event_id;
  let profCalendario = t.google_calendar_prof_id;

  // Sacarlo del calendario donde estaba si se canceló o cambió de profesional.
  if (eventoId && profCalendario && (!activo || profCalendario !== t.profesional_id)) {
    const acceso = await accesoProfesional(profCalendario);
    if (acceso) {
      const r = await api(acceso.token, "DELETE", `/calendars/${cal(acceso)}/events/${encodeURIComponent(eventoId)}`);
      if (!r.ok && r.status !== 404 && r.status !== 410) throw await errorDeApi(r, "borrar");
    }
    eventoId = null;
    profCalendario = null;
  }

  if (activo) {
    const acceso = await accesoProfesional(t.profesional_id);
    if (acceso) {
      const id = idEvento(t.id);
      const cuerpo = cuerpoEvento(t);
      // PATCH primero: actualiza el evento si existe (o lo reactiva si se había borrado).
      let r = await api(acceso.token, "PATCH", `/calendars/${cal(acceso)}/events/${id}`, cuerpo);
      if (r.status === 404) r = await api(acceso.token, "POST", `/calendars/${cal(acceso)}/events`, { id, ...cuerpo });
      if (!r.ok) throw await errorDeApi(r, "guardar");
      eventoId = id;
      profCalendario = t.profesional_id;
    }
  }

  await admin.rpc("marcar_sincronizado_google", {
    p_turno_id: t.id,
    p_version: t.updated_at,
    p_event_id: eventoId,
    p_prof_id: profCalendario,
  });
}

/** Después de responder, refleja el cambio de un turno en Google (si aplica). */
export function sincronizarGoogleDespues(turnoId: string) {
  if (!integracionesDisponibles().google) return;
  after(async () => {
    try {
      await sincronizarTurno(turnoId);
    } catch (e) {
      // Queda en la cola: el cron lo reintenta.
      console.error("[google] sincronizar turno", turnoId, e);
    }
  });
}

/** Procesa la cola de turnos pendientes de sincronizar (cron). */
export async function sincronizarPendientes(limite = 50) {
  const admin = crearSupabaseAdmin();
  const { data, error } = await admin.rpc("turnos_para_sincronizar", { p_limite: limite });
  if (error) throw error;
  let ok = 0;
  let fallidos = 0;
  for (const fila of (data ?? []) as { turno_id: string }[]) {
    try {
      await sincronizarTurno(fila.turno_id);
      ok++;
    } catch (e) {
      fallidos++;
      console.error("[google] cola", fila.turno_id, e);
    }
  }
  return { ok, fallidos };
}

// --- Google -> Agenda2 (ocupados) ----------------------------------------------------

type EventoGoogle = {
  status?: string;
  transparency?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
  extendedProperties?: { private?: Record<string, string> };
};

/**
 * Importa como ausencias los horarios ocupados del calendario del profesional,
 * desde ahora hasta el máximo de anticipación del negocio. Ignora los eventos
 * creados por Agenda2 (marcados con turniaTurnoId), los marcados como "disponible" y los rechazados.
 */
export async function importarOcupados(integracion: Integracion<ConfigGoogle>) {
  if (!integracion.profesional_id) return 0;
  const admin = crearSupabaseAdmin();
  const { data: negocio } = await admin
    .from("negocios")
    .select("zona_horaria, anticipacion_max_dias")
    .eq("id", integracion.negocio_id)
    .single();
  const tz = negocio?.zona_horaria ?? "America/Argentina/Buenos_Aires";
  const desde = new Date();
  const hasta = localADate(sumarDias(fechaLocalISO(desde, tz), Math.min(negocio?.anticipacion_max_dias ?? 30, 90) + 1), "00:00", tz);

  const ocupados: { inicio: string; fin: string }[] = [];
  if (integracion.config.importar_ocupado) {
    const acceso = await accesoProfesional(integracion.profesional_id);
    if (!acceso) return 0;
    let pagina: string | undefined;
    for (let i = 0; i < 5; i++) {
      const params = new URLSearchParams({
        timeMin: desde.toISOString(),
        timeMax: hasta.toISOString(),
        singleEvents: "true",
        maxResults: "2500",
        fields: "nextPageToken,items(status,transparency,start,end,attendees(self,responseStatus),extendedProperties)",
      });
      if (pagina) params.set("pageToken", pagina);
      const r = await api(acceso.token, "GET", `/calendars/${cal(acceso)}/events?${params}`);
      if (!r.ok) throw await errorDeApi(r, "leer eventos");
      const cuerpo = (await r.json()) as { items?: EventoGoogle[]; nextPageToken?: string };
      for (const ev of cuerpo.items ?? []) {
        if (ev.status === "cancelled" || ev.transparency === "transparent") continue;
        if (ev.extendedProperties?.private?.turniaTurnoId) continue;
        if (ev.attendees?.some((a) => a.self && a.responseStatus === "declined")) continue;
        const inicio = ev.start?.dateTime ?? (ev.start?.date ? localADate(ev.start.date, "00:00", tz).toISOString() : null);
        const fin = ev.end?.dateTime ?? (ev.end?.date ? localADate(ev.end.date, "00:00", tz).toISOString() : null);
        if (inicio && fin) ocupados.push({ inicio, fin });
      }
      pagina = cuerpo.nextPageToken;
      if (!pagina) break;
    }
  }

  const { data: cantidad, error } = await admin.rpc("reemplazar_bloqueos_google", {
    p_profesional_id: integracion.profesional_id,
    p_desde: desde.toISOString(),
    p_hasta: hasta.toISOString(),
    p_ocupados: ocupados,
  });
  if (error) throw error;
  await actualizarIntegracion(integracion, {
    config: { ultima_sync: new Date().toISOString(), ultimo_error: null },
  });
  return (cantidad as number | null) ?? 0;
}

/** Importa los ocupados de todas las cuentas conectadas (cron). */
export async function importarOcupadosTodos() {
  const admin = crearSupabaseAdmin();
  const { data } = await admin.from("integraciones").select("*").eq("proveedor", "google_calendar").eq("estado", "activa");
  let ok = 0;
  let fallidos = 0;
  for (const integracion of (data ?? []) as Integracion<ConfigGoogle>[]) {
    try {
      await importarOcupados(integracion);
      ok++;
    } catch (e) {
      fallidos++;
      console.error("[google] importar ocupados", integracion.id, e);
      await actualizarIntegracion(integracion, {
        config: { ultimo_error: "No se pudo leer el calendario. Se reintenta en la próxima hora." },
      });
    }
  }
  return { ok, fallidos };
}

// --- Desconectar -------------------------------------------------------------------

/**
 * Quita la conexión: borra de Google los turnos futuros que había creado,
 * elimina las ausencias importadas y revoca el permiso.
 */
export async function desconectarGoogle(integracion: Integracion<ConfigGoogle>) {
  const admin = crearSupabaseAdmin();
  const profesionalId = integracion.profesional_id;

  if (profesionalId) {
    const acceso = await accesoProfesional(profesionalId).catch(() => null);
    const { data: turnos } = await admin
      .from("turnos")
      .select("id, google_event_id")
      .eq("google_calendar_prof_id", profesionalId)
      .not("google_event_id", "is", null)
      .gt("fin", new Date().toISOString())
      .limit(200);
    if (acceso) {
      for (const t of turnos ?? []) {
        await api(acceso.token, "DELETE", `/calendars/${cal(acceso)}/events/${encodeURIComponent(t.google_event_id)}`).catch(
          () => null,
        );
      }
    }
    await admin
      .from("turnos")
      .update({ google_event_id: null, google_calendar_prof_id: null })
      .eq("google_calendar_prof_id", profesionalId);
    await admin.from("bloqueos").delete().eq("profesional_id", profesionalId).eq("origen", "google");
  }

  const secreto = await leerSecreto<SecretoGoogle>(integracion.id);
  if (secreto) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(secreto.refresh_token)}`, {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
  }
  cacheTokens.delete(integracion.id);
  await borrarIntegracion(integracion.id);
}
