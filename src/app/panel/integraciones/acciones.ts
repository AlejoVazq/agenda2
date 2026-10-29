"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sesionParaAccion } from "@/lib/auth";
import { integracionesDisponibles } from "@/lib/env";
import { mensajeDeError } from "@/lib/errores";
import { desconectarGoogle, importarOcupados, sincronizarPendientes, type ConfigGoogle } from "@/lib/google";
import { actualizarIntegracion, borrarIntegracion, buscarIntegracion, guardarIntegracion } from "@/lib/integraciones";
import { verificarTokenMercadoPago, type ConfigMercadoPago } from "@/lib/mercadopago";
import { sesionConPermisoSobreProfesional } from "@/lib/permisos";
import { crearSupabaseServidor } from "@/lib/supabase/server";
import { datosDeForm, erroresDeCampo, esquemaSena } from "@/lib/validaciones";
import type { EstadoAccion } from "@/lib/tipos";

const RUTA = "/panel/integraciones";

// --- Mercado Pago (solo dueño) -------------------------------------------------------

const esquemaTokenMP = z.object({
  access_token: z
    .string()
    .trim()
    .regex(/^(APP_USR|TEST)-[A-Za-z0-9-]{20,200}$/, "Pegá el Access Token completo (empieza con APP_USR- o TEST-)."),
});

export async function conectarMercadoPago(_prev: EstadoAccion, formData: FormData): Promise<EstadoAccion> {
  const sesion = await sesionParaAccion({ soloDueno: true });
  if (!sesion) return { error: "Solo el dueño puede conectar Mercado Pago." };
  if (!integracionesDisponibles().mercadopago) return { error: "Las integraciones no están configuradas en el servidor." };

  const datos = esquemaTokenMP.safeParse(datosDeForm(formData));
  if (!datos.success) return { errores: erroresDeCampo(datos.error) };

  try {
    const config = await verificarTokenMercadoPago(datos.data.access_token);
    await guardarIntegracion<ConfigMercadoPago, { access_token: string }>({
      negocioId: sesion.negocio.id,
      proveedor: "mercadopago",
      config,
      secreto: { access_token: datos.data.access_token },
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo conectar Mercado Pago." };
  }

  revalidatePath(RUTA);
  return { ok: true, mensaje: "Mercado Pago quedó conectado." };
}

export async function desconectarMercadoPago(): Promise<EstadoAccion> {
  const sesion = await sesionParaAccion({ soloDueno: true });
  if (!sesion) return { error: "Solo el dueño puede desconectar Mercado Pago." };
  const integracion = await buscarIntegracion(sesion.negocio.id, "mercadopago");
  if (integracion) await borrarIntegracion(integracion.id);
  revalidatePath(RUTA);
  return { ok: true, mensaje: "Mercado Pago se desconectó. Las reservas ya no piden seña." };
}

export async function guardarSena(_prev: EstadoAccion, formData: FormData): Promise<EstadoAccion> {
  const sesion = await sesionParaAccion({ soloDueno: true });
  if (!sesion) return { error: "Solo el dueño puede cambiar la seña." };

  const datos = esquemaSena.safeParse(datosDeForm(formData));
  if (!datos.success) return { errores: erroresDeCampo(datos.error) };

  const supabase = await crearSupabaseServidor();
  const { error } = await supabase.from("negocios").update(datos.data).eq("id", sesion.negocio.id);
  if (error) return { error: mensajeDeError(error) };

  revalidatePath(RUTA);
  return { ok: true, mensaje: "Seña guardada." };
}

// --- WhatsApp (solo dueño) -------------------------------------------------------------

export async function guardarWhatsApp(_prev: EstadoAccion, formData: FormData): Promise<EstadoAccion> {
  const sesion = await sesionParaAccion({ soloDueno: true });
  if (!sesion) return { error: "Solo el dueño puede cambiar esta opción." };

  const supabase = await crearSupabaseServidor();
  const { error } = await supabase
    .from("negocios")
    .update({ whatsapp_avisos: formData.get("whatsapp_avisos") === "on" })
    .eq("id", sesion.negocio.id);
  if (error) return { error: mensajeDeError(error) };

  revalidatePath(RUTA);
  return { ok: true, mensaje: "Preferencia guardada." };
}

// --- Google Calendar (dueño o el propio profesional) ---------------------------------

async function integracionGoogle(profesionalId: string) {
  if (!z.uuid().safeParse(profesionalId).success) return null;
  const sesion = await sesionConPermisoSobreProfesional(profesionalId);
  if (!sesion) return null;
  return buscarIntegracion<ConfigGoogle>(sesion.negocio.id, "google_calendar", profesionalId);
}

export async function desconectarCalendario(profesionalId: string): Promise<EstadoAccion> {
  const integracion = await integracionGoogle(profesionalId);
  if (!integracion) return { error: "No tenés permiso o la cuenta ya estaba desconectada." };
  try {
    await desconectarGoogle(integracion);
  } catch (e) {
    console.error("[google] desconectar", e);
    return { error: "No se pudo desconectar. Probá de nuevo." };
  }
  revalidatePath(RUTA);
  return { ok: true, mensaje: "Google Calendar se desconectó." };
}

export async function sincronizarCalendario(profesionalId: string): Promise<EstadoAccion> {
  const integracion = await integracionGoogle(profesionalId);
  if (!integracion || integracion.estado !== "activa") return { error: "La cuenta no está conectada." };
  try {
    await importarOcupados(integracion);
    await sincronizarPendientes(100);
  } catch (e) {
    console.error("[google] sincronizar ahora", e);
    return { error: "Google no respondió. Probá de nuevo en un rato." };
  }
  revalidatePath(RUTA);
  revalidatePath("/panel/agenda");
  return { ok: true, mensaje: "Calendario sincronizado." };
}

export async function cambiarImportarOcupado(profesionalId: string, importar: boolean): Promise<EstadoAccion> {
  const integracion = await integracionGoogle(profesionalId);
  if (!integracion) return { error: "No tenés permiso." };
  const actualizada = { ...integracion, config: { ...integracion.config, importar_ocupado: importar } };
  await actualizarIntegracion(integracion, { config: { importar_ocupado: importar } });
  try {
    // Sin importar, se borran los ocupados que se habían traído.
    await importarOcupados(actualizada);
  } catch (e) {
    console.error("[google] importar ocupados", e);
  }
  revalidatePath(RUTA);
  return { ok: true };
}
