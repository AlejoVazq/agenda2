import "server-only";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { comoServidor, sql } from "@/lib/db";

/**
 * Límite de uso por IP para acciones públicas (reservar, consultar horarios,
 * login, registro). La IP se guarda solo como hash con un secreto del servidor.
 * Si la base no responde, deja pasar: el límite es una protección extra, no la
 * única (crear_reserva y Better Auth tienen las suyas).
 *
 * La IP sale del primer valor de X-Forwarded-For: el proxy (Caddy) tiene que
 * PISAR ese header con la IP real, si no cualquiera esquiva el límite.
 */
export async function dentroDelLimite(accion: string, maximo: number, ventanaSeg: number) {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "sin-ip";
  const secreto = process.env.BETTER_AUTH_SECRET ?? "";
  const huella = createHash("sha256").update(`${ip}|${secreto}`).digest("base64url").slice(0, 24);
  try {
    const fila = await comoServidor((tx) =>
      tx.uno<{ ok: boolean }>(sql`select public.consumir_limite(${`${accion}:${huella}`}, ${maximo}, ${ventanaSeg}) as ok`),
    );
    return fila?.ok !== false;
  } catch (e) {
    console.error("[limites] no se pudo consultar el límite", e);
    return true;
  }
}
