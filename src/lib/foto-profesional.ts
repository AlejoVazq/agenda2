import "server-only";
import { comoServidor, sql } from "@/lib/db";
import type { TipoLogo } from "@/lib/logo";

// Foto de cada profesional (tabla public.profesional_fotos, migración 0017). Como los
// logos, solo el rol del servidor la lee y la escribe: quien llama ya verificó permisos.
// Se ve solo en el panel.

export const FOTO_MAX_BYTES = 512 * 1024;

/** Versión de la foto de cada profesional del negocio que tiene una (marca de tiempo). */
export async function versionesFotos(negocioId: string): Promise<Map<string, number>> {
  const filas = await comoServidor((tx) =>
    tx.varios<{ id: string; v: string }>(sql`
      select f.profesional_id as id, (extract(epoch from f.actualizado_at) * 1000)::bigint::text as v
      from public.profesional_fotos f join public.profesionales p on p.id = f.profesional_id
      where p.negocio_id = ${negocioId}`),
  ).catch((e) => {
    console.error("[foto] versionesFotos", e);
    return [];
  });
  return new Map(filas.map((f) => [f.id, Number(f.v)]));
}

/** URL de la foto en el panel; cambia con cada versión. */
export function urlFoto(profesionalId: string, version: number | undefined): string | null {
  return version ? `/panel/profesionales/${profesionalId}/foto?v=${version}` : null;
}

/** La foto de un profesional de este negocio. */
export async function fotoDe(profesionalId: string, negocioId: string) {
  return comoServidor((tx) =>
    tx.uno<{ tipo: TipoLogo; datos: Buffer }>(sql`
      select f.tipo, f.datos
      from public.profesional_fotos f join public.profesionales p on p.id = f.profesional_id
      where f.profesional_id = ${profesionalId} and p.negocio_id = ${negocioId}`),
  );
}

export async function guardarFoto(profesionalId: string, tipo: TipoLogo, datos: Buffer): Promise<void> {
  await comoServidor((tx) =>
    tx.ejecutar(sql`
      insert into public.profesional_fotos (profesional_id, tipo, datos)
      values (${profesionalId}, ${tipo}, ${datos})
      on conflict (profesional_id) do update set tipo = excluded.tipo, datos = excluded.datos, actualizado_at = now()`),
  );
}

export async function borrarFoto(profesionalId: string): Promise<void> {
  await comoServidor((tx) => tx.ejecutar(sql`delete from public.profesional_fotos where profesional_id = ${profesionalId}`));
}
