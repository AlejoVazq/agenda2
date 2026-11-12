// Suscripción de cada negocio (plan mensual, pagos registrados a mano por el admin).
// El estado lo calcula la base (plataforma.estado_suscripcion, migración 0002) con
// prueba_hasta, pagado_hasta y suspendido_at; acá solo se muestra.
//
// Si no está habilitado, la base ya rechaza las escrituras del panel y los turnos
// nuevos (NEGOCIO_NO_HABILITADO). Las acciones que escriben con el rol del servidor
// (equipo, integraciones) lo chequean con `sesion.habilitado`.

export type EstadoSuscripcion = "prueba" | "activa" | "gracia" | "vencida" | "suspendida";

export type Suscripcion = {
  estado: EstadoSuscripcion;
  prueba_hasta: string;
  pagado_hasta: string | null;
  /** Hasta cuándo funciona (fin de la gracia). Null si está suspendido. */
  fin_servicio: string | null;
  suspension_motivo: string | null;
};

export const DIAS_PRUEBA = 7;
/** Igual que plataforma.dias_gracia() en la base. */
export const DIAS_GRACIA = 5;

export function estaHabilitado(estado: EstadoSuscripcion) {
  return estado === "prueba" || estado === "activa" || estado === "gracia";
}

export const MENSAJE_SOLO_LECTURA =
  "Tu suscripción no está activa: el panel quedó en solo lectura. Escribinos para renovarla.";

/** Días que faltan hasta `fecha` (redondeado para arriba; 0 si ya pasó). */
export function diasHasta(fecha: string | null | undefined): number {
  if (!fecha) return 0;
  return Math.max(0, Math.ceil((new Date(fecha).getTime() - Date.now()) / 86_400_000));
}

export const ETIQUETA_ESTADO: Record<EstadoSuscripcion, string> = {
  prueba: "En prueba",
  activa: "Activa",
  gracia: "En gracia",
  vencida: "Vencida",
  suspendida: "Suspendida",
};
