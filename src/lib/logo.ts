import "server-only";
import { cache } from "react";
import { comoServidor, sql } from "@/lib/db";

// Logo de cada negocio (tabla public.negocio_logos, migración 0006). Solo el rol del
// servidor la lee y la escribe: quien llama ya verificó permisos (o es público).

export const LOGO_MAX_BYTES = 512 * 1024;
export type TipoLogo = "image/png" | "image/jpeg" | "image/webp";

/** Tipo real según los primeros bytes (no se confía en lo que dice el navegador). SVG no: puede llevar scripts. */
export function tipoDeImagen(b: Uint8Array): TipoLogo | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  const ascii = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));
  if (b.length > 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image/webp";
  return null;
}

/** Versión del logo (marca de tiempo) para armar la URL, o null si no tiene. */
export const versionLogo = cache(async (negocioId: string): Promise<number | null> => {
  try {
    const fila = await comoServidor((tx) =>
      tx.uno<{ v: string }>(sql`
        select (extract(epoch from actualizado_at) * 1000)::bigint::text as v
        from public.negocio_logos where negocio_id = ${negocioId}`),
    );
    return fila ? Number(fila.v) : null;
  } catch (e) {
    console.error("[logo] versionLogo", e);
    return null;
  }
});

/** URL pública del logo; cambia con cada versión, así se puede cachear para siempre. */
export function urlLogo(slug: string, version: number | null): string | null {
  return version ? `/n/${slug}/logo?v=${version}` : null;
}

/** El logo de un negocio activo, por su dirección pública. */
export async function logoPorSlug(slug: string): Promise<{ tipo: TipoLogo; datos: Buffer } | null> {
  return comoServidor((tx) =>
    tx.uno<{ tipo: TipoLogo; datos: Buffer }>(sql`
      select l.tipo, l.datos
      from public.negocio_logos l
      join public.negocios n on n.id = l.negocio_id
      where n.slug = lower(${slug}) and n.activo`),
  );
}

/** El logo como data URI (para las imágenes de `next/og`). */
export async function logoDataUri(slug: string): Promise<string | null> {
  const logo = await logoPorSlug(slug).catch(() => null);
  return logo ? `data:${logo.tipo};base64,${logo.datos.toString("base64")}` : null;
}

export async function guardarLogo(negocioId: string, tipo: TipoLogo, datos: Buffer): Promise<void> {
  await comoServidor((tx) =>
    tx.ejecutar(sql`
      insert into public.negocio_logos (negocio_id, tipo, datos)
      values (${negocioId}, ${tipo}, ${datos})
      on conflict (negocio_id) do update set tipo = excluded.tipo, datos = excluded.datos, actualizado_at = now()`),
  );
}

export async function borrarLogo(negocioId: string): Promise<void> {
  await comoServidor((tx) => tx.ejecutar(sql`delete from public.negocio_logos where negocio_id = ${negocioId}`));
}
