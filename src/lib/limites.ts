import "server-only";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { env } from "@/lib/env";
import { crearSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Límite de uso por IP para acciones públicas (reservar, consultar horarios).
 * La IP se guarda solo como hash. Si la base no responde, deja pasar: el
 * límite es una protección extra, no la única (crear_reserva tiene la suya).
 */
export async function dentroDelLimite(accion: string, maximo: number, ventanaSeg: number) {
  if (!env.supabaseServiceRoleKey) return true;
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "sin-ip";
  const huella = createHash("sha256").update(`${ip}|${env.supabaseServiceRoleKey}`).digest("base64url").slice(0, 24);
  try {
    const { data, error } = await crearSupabaseAdmin().rpc("consumir_limite", {
      p_clave: `${accion}:${huella}`,
      p_maximo: maximo,
      p_ventana_seg: ventanaSeg,
    });
    if (error) return true;
    return data !== false;
  } catch {
    return true;
  }
}
