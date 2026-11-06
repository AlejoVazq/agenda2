// Variables de entorno centralizadas. Las NEXT_PUBLIC_* se exponen al navegador.
export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  siteUrl: (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
};

/**
 * Seña con Mercado Pago: apagada por ahora, sin borrar la función. Con esto en false
 * no se puede conectar Mercado Pago y, sin esa conexión, la base no pide seña y la
 * interfaz no la muestra. Para volver a ofrecerla, alcanza con pasarlo a true.
 */
export const SENA_ACTIVA = false;

/**
 * Qué integraciones están configuradas en este servidor. Todas son opcionales:
 * si falta una variable, la función correspondiente se oculta o se omite.
 * Solo usar del lado del servidor (lee secretos).
 */
export function integracionesDisponibles() {
  const cifrado = (process.env.INTEGRACIONES_CLAVE ?? "").length >= 32;
  const admin = Boolean(env.supabaseServiceRoleKey);
  return {
    /** Se pueden guardar credenciales de terceros (cifradas). */
    cifrado: cifrado && admin,
    google: cifrado && admin && Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    mercadopago: SENA_ACTIVA && cifrado && admin,
    whatsapp: admin && Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID),
  };
}
