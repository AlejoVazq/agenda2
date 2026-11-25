// Variables de entorno centralizadas. Las NEXT_PUBLIC_* se exponen al navegador.
export const env = {
  siteUrl: (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  /** Mail de contacto que se muestra en la política de privacidad. */
  contactoEmail: process.env.NEXT_PUBLIC_CONTACTO_EMAIL ?? "",
  /** Conexión de la app (rol agenda2_app). Solo servidor. */
  databaseUrl: process.env.DATABASE_URL ?? "",
};

/**
 * Seña de turnos con Mercado Pago: apagada, sin borrar la función. Desde 2026-11-24
 * (tienda de productos) solo oculta la configuración de la seña: Mercado Pago se conecta
 * igual para cobrar pedidos, y la base no pide seña (`public.monto_sena` devuelve 0).
 * Para volver a ofrecerla hay que pasarlo a true y devolver `monto_sena` en una migración.
 */
export const SENA_ACTIVA = false;

/**
 * Qué integraciones están configuradas en este servidor. Todas son opcionales:
 * si falta una variable, la función correspondiente se oculta o se omite.
 * Solo usar del lado del servidor (lee secretos).
 */
export function integracionesDisponibles() {
  const cifrado = (process.env.INTEGRACIONES_CLAVE ?? "").length >= 32;
  return {
    /** Se pueden guardar credenciales de terceros (cifradas). */
    cifrado,
    google: cifrado && Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    /** Cobrar pedidos de la tienda (y la seña, si algún día se vuelve a prender). */
    mercadopago: cifrado,
    whatsapp: Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID),
  };
}
