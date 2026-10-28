import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Cliente con service role: SALTEA RLS. Usar solo en el servidor, solo después
 * de haber verificado permisos del usuario actual, y solo para operaciones que
 * RLS no permite por diseño (p.ej. crear el usuario de un empleado invitado).
 */
export function crearSupabaseAdmin() {
  if (!env.supabaseServiceRoleKey) {
    throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en el entorno del servidor.");
  }
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
