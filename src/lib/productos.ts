import "server-only";
import { cache } from "react";
import { comoServidor, sql } from "@/lib/db";
import { integracionesDisponibles } from "@/lib/env";
import type { TipoLogo } from "@/lib/logo";
import type { MedioPago } from "@/lib/tipos";

// Productos de la tienda (migración 0020). El portal es anónimo y el anónimo no lee
// tablas: lo público se lee con el rol del servidor y acá se decide qué se muestra (solo
// productos activos de un negocio activo). Las fotos (public.producto_fotos), como los
// logos: solo el servidor las lee y escribe; quien llama ya verificó permisos.

export const PRODUCTO_FOTO_MAX_BYTES = 512 * 1024;

export type ProductoPublico = {
  id: string;
  nombre: string;
  descripcion: string | null;
  precio: number;
  stock: number;
  /** Versión de la foto (marca de tiempo) o null si no tiene. */
  foto_v: number | null;
};

/** Productos activos del negocio, en orden, con su stock y la versión de la foto. */
export const productosPublicos = cache(async (negocioId: string): Promise<ProductoPublico[]> => {
  const filas = await comoServidor((tx) =>
    tx.varios<Omit<ProductoPublico, "foto_v"> & { foto_v: string | null }>(sql`
      select p.id, p.nombre, p.descripcion, p.precio, p.stock,
        (extract(epoch from f.actualizado_at) * 1000)::bigint::text as foto_v
      from public.productos p
      join public.negocios n on n.id = p.negocio_id and n.activo
      left join public.producto_fotos f on f.producto_id = p.id
      where p.negocio_id = ${negocioId} and p.activo
      order by p.orden, p.nombre, p.id`),
  );
  return filas.map((f) => ({ ...f, foto_v: f.foto_v ? Number(f.foto_v) : null }));
});

/**
 * Si la tienda está prendida y con qué medios se puede pagar hoy: sin Mercado Pago si la
 * integración no está activa (o el servidor no la ofrece) y sin transferencia si no hay
 * alias ni CBU (los mismos chequeos que hace `crear_pedido`). Null si el negocio no existe.
 */
export const tiendaPublica = cache(
  async (negocioId: string): Promise<{ activa: boolean; medios: MedioPago[] } | null> => {
    const fila = await comoServidor((tx) =>
      tx.uno<{ activa: boolean; medios: MedioPago[]; transferencia: boolean; mercadopago: boolean }>(sql`
        select n.tienda_activa and plataforma.negocio_toma_reservas(n.id) as activa,
          n.tienda_medios as medios,
          (n.transferencia_alias is not null or n.transferencia_cbu is not null) as transferencia,
          exists (
            select 1 from public.integraciones ig
            where ig.negocio_id = n.id and ig.proveedor = 'mercadopago' and ig.estado = 'activa'
          ) as mercadopago
        from public.negocios n where n.id = ${negocioId} and n.activo`),
    );
    if (!fila) return null;
    const mpDisponible = fila.mercadopago && integracionesDisponibles().mercadopago;
    const medios = fila.medios.filter(
      (m) => (m !== "mercadopago" || mpDisponible) && (m !== "transferencia" || fila.transferencia),
    );
    return { activa: fila.activa && medios.length > 0, medios };
  },
);

/** Versión de la foto de un producto (marca de tiempo), o null si no tiene. */
export async function versionFoto(productoId: string): Promise<number | null> {
  const fila = await comoServidor((tx) =>
    tx.uno<{ v: string }>(sql`
      select (extract(epoch from actualizado_at) * 1000)::bigint::text as v
      from public.producto_fotos where producto_id = ${productoId}`),
  ).catch((e) => {
    console.error("[productos] versionFoto", e);
    return null;
  });
  return fila ? Number(fila.v) : null;
}

/** URL pública de la foto; cambia con cada versión, así se puede cachear para siempre. */
export function urlFotoProducto(slug: string, productoId: string, version: number | null): string | null {
  return version ? `/n/${slug}/productos/${productoId}/foto?v=${version}` : null;
}

/** La foto de un producto activo de un negocio activo, por la dirección pública. */
export async function fotoProductoPorSlug(
  slug: string,
  productoId: string,
): Promise<{ tipo: TipoLogo; datos: Buffer } | null> {
  return comoServidor((tx) =>
    tx.uno<{ tipo: TipoLogo; datos: Buffer }>(sql`
      select f.tipo, f.datos
      from public.producto_fotos f
      join public.productos p on p.id = f.producto_id and p.activo
      join public.negocios n on n.id = p.negocio_id and n.activo
      where n.slug = lower(${slug}) and f.producto_id = ${productoId}`),
  );
}

export async function guardarFotoProducto(productoId: string, tipo: TipoLogo, datos: Buffer): Promise<void> {
  await comoServidor((tx) =>
    tx.ejecutar(sql`
      insert into public.producto_fotos (producto_id, tipo, datos)
      values (${productoId}, ${tipo}, ${datos})
      on conflict (producto_id) do update set tipo = excluded.tipo, datos = excluded.datos, actualizado_at = now()`),
  );
}

export async function borrarFotoProducto(productoId: string): Promise<void> {
  await comoServidor((tx) => tx.ejecutar(sql`delete from public.producto_fotos where producto_id = ${productoId}`));
}

// --- Panel: fotos de todos los productos del negocio (también los inactivos) ------------

/** Versión de la foto de cada producto del negocio que tiene una (marca de tiempo). */
export async function versionesFotosProductos(negocioId: string): Promise<Map<string, number>> {
  const filas = await comoServidor((tx) =>
    tx.varios<{ id: string; v: string }>(sql`
      select f.producto_id as id, (extract(epoch from f.actualizado_at) * 1000)::bigint::text as v
      from public.producto_fotos f join public.productos p on p.id = f.producto_id
      where p.negocio_id = ${negocioId}`),
  ).catch((e) => {
    console.error("[productos] versionesFotosProductos", e);
    return [];
  });
  return new Map(filas.map((f) => [f.id, Number(f.v)]));
}

/** URL de la foto en el panel (sirve también para productos inactivos). */
export function urlFotoProductoPanel(productoId: string, version: number | null | undefined): string | null {
  return version ? `/panel/productos/${productoId}/foto?v=${version}` : null;
}

/** La foto de un producto de este negocio, activo o no (para el panel). */
export async function fotoProductoDe(productoId: string, negocioId: string) {
  return comoServidor((tx) =>
    tx.uno<{ tipo: TipoLogo; datos: Buffer }>(sql`
      select f.tipo, f.datos
      from public.producto_fotos f join public.productos p on p.id = f.producto_id
      where f.producto_id = ${productoId} and p.negocio_id = ${negocioId}`),
  );
}
