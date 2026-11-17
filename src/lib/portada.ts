import "server-only";
import { cache } from "react";
import { comoServidor, sql } from "@/lib/db";
import type { TipoLogo } from "@/lib/logo";

// Portada de la página de reservas (tabla public.negocio_portadas, migración 0011). Como el
// logo: solo el rol del servidor la lee y la escribe; quien llama ya verificó permisos.

export const PORTADA_MAX_BYTES = 900 * 1024;

/**
 * Color de la página y versión de la portada (marca de tiempo, para la URL; null si no
 * tiene). El portal es anónimo y negocio_publico no los trae: se leen con el servidor.
 */
export const aparienciaNegocio = cache(
  async (negocioId: string): Promise<{ color: string | null; portada: number | null }> => {
    try {
      const fila = await comoServidor((tx) =>
        tx.uno<{ color: string | null; v: string | null }>(sql`
          select n.color, (extract(epoch from p.actualizado_at) * 1000)::bigint::text as v
          from public.negocios n
          left join public.negocio_portadas p on p.negocio_id = n.id
          where n.id = ${negocioId}`),
      );
      return { color: fila?.color ?? null, portada: fila?.v ? Number(fila.v) : null };
    } catch (e) {
      console.error("[portada] aparienciaNegocio", e);
      return { color: null, portada: null };
    }
  },
);

/** URL pública; cambia con cada versión, así se puede cachear para siempre. */
export function urlPortada(slug: string, version: number | null): string | null {
  return version ? `/n/${slug}/portada?v=${version}` : null;
}

/** La portada de un negocio activo, por su dirección pública. */
export async function portadaPorSlug(slug: string): Promise<{ tipo: TipoLogo; datos: Buffer } | null> {
  return comoServidor((tx) =>
    tx.uno<{ tipo: TipoLogo; datos: Buffer }>(sql`
      select p.tipo, p.datos
      from public.negocio_portadas p
      join public.negocios n on n.id = p.negocio_id
      where n.slug = lower(${slug}) and n.activo`),
  );
}

export async function guardarPortada(negocioId: string, tipo: TipoLogo, datos: Buffer): Promise<void> {
  await comoServidor((tx) =>
    tx.ejecutar(sql`
      insert into public.negocio_portadas (negocio_id, tipo, datos)
      values (${negocioId}, ${tipo}, ${datos})
      on conflict (negocio_id) do update set tipo = excluded.tipo, datos = excluded.datos, actualizado_at = now()`),
  );
}

export async function borrarPortada(negocioId: string): Promise<void> {
  await comoServidor((tx) => tx.ejecutar(sql`delete from public.negocio_portadas where negocio_id = ${negocioId}`));
}
