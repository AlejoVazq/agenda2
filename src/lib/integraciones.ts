import "server-only";
import { cifrar, descifrar } from "@/lib/cifrado";
import { crearSupabaseAdmin } from "@/lib/supabase/admin";

// Acceso a integraciones y sus secretos. Todo pasa por el service role: llamar
// solo después de verificar que el usuario actual tiene permiso sobre el negocio
// o profesional en cuestión (o desde procesos del servidor como el cron).

export type Proveedor = "google_calendar" | "mercadopago" | "whatsapp";
export type EstadoIntegracion = "inactiva" | "activa" | "error";

export type Integracion<C = Record<string, unknown>> = {
  id: string;
  negocio_id: string;
  profesional_id: string | null;
  proveedor: Proveedor;
  estado: EstadoIntegracion;
  config: C;
  updated_at: string;
};

export async function buscarIntegracion<C>(
  negocioId: string,
  proveedor: Proveedor,
  profesionalId: string | null = null,
): Promise<Integracion<C> | null> {
  const admin = crearSupabaseAdmin();
  let consulta = admin.from("integraciones").select("*").eq("negocio_id", negocioId).eq("proveedor", proveedor);
  consulta = profesionalId ? consulta.eq("profesional_id", profesionalId) : consulta.is("profesional_id", null);
  const { data } = await consulta.maybeSingle();
  return (data as Integracion<C> | null) ?? null;
}

export async function leerSecreto<S>(integracionId: string): Promise<S | null> {
  const admin = crearSupabaseAdmin();
  const { data } = await admin.from("integraciones_secretos").select("datos").eq("integracion_id", integracionId).maybeSingle();
  if (!data) return null;
  try {
    return descifrar<S>(data.datos);
  } catch (e) {
    console.error("[integraciones] no se pudo descifrar el secreto", integracionId, e);
    return null;
  }
}

/** Crea o reemplaza la integración (y su secreto) y la deja activa. */
export async function guardarIntegracion<C, S>(datos: {
  negocioId: string;
  proveedor: Proveedor;
  profesionalId?: string | null;
  config: C;
  secreto: S;
}) {
  const admin = crearSupabaseAdmin();
  const existente = await buscarIntegracion(datos.negocioId, datos.proveedor, datos.profesionalId ?? null);

  let id = existente?.id;
  if (id) {
    const { error } = await admin.from("integraciones").update({ estado: "activa", config: datos.config }).eq("id", id);
    if (error) throw error;
  } else {
    const { data, error } = await admin
      .from("integraciones")
      .insert({
        negocio_id: datos.negocioId,
        profesional_id: datos.profesionalId ?? null,
        proveedor: datos.proveedor,
        estado: "activa",
        config: datos.config,
      })
      .select("id")
      .single();
    if (error) throw error;
    id = data.id as string;
  }

  const { error } = await admin
    .from("integraciones_secretos")
    .upsert({ integracion_id: id, datos: cifrar(datos.secreto) }, { onConflict: "integracion_id" });
  if (error) throw error;
  return id;
}

export async function actualizarSecreto<S>(integracionId: string, secreto: S) {
  const admin = crearSupabaseAdmin();
  await admin.from("integraciones_secretos").update({ datos: cifrar(secreto) }).eq("integracion_id", integracionId);
}

/** Cambia estado y/o mezcla datos en config (p. ej. último error o sincronización). */
export async function actualizarIntegracion(
  integracion: Pick<Integracion, "id" | "config">,
  cambios: { estado?: EstadoIntegracion; config?: Record<string, unknown> },
) {
  const admin = crearSupabaseAdmin();
  const fila: Record<string, unknown> = {};
  if (cambios.estado) fila.estado = cambios.estado;
  if (cambios.config) fila.config = { ...integracion.config, ...cambios.config };
  if (Object.keys(fila).length) await admin.from("integraciones").update(fila).eq("id", integracion.id);
}

export async function borrarIntegracion(integracionId: string) {
  const admin = crearSupabaseAdmin();
  // El secreto se borra en cascada.
  const { error } = await admin.from("integraciones").delete().eq("id", integracionId);
  if (error) throw error;
}
