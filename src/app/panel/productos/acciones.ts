"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { sesionParaAccion } from "@/lib/auth";
import { comoUsuario, sql } from "@/lib/db";
import { mensajeDeError } from "@/lib/errores";
import { tipoDeImagen } from "@/lib/logo";
import { borrarFotoProducto, guardarFotoProducto, PRODUCTO_FOTO_MAX_BYTES } from "@/lib/productos";
import { MENSAJE_SOLO_LECTURA } from "@/lib/suscripcion";
import { datosDeForm, erroresDeCampo, esquemaProducto } from "@/lib/validaciones";
import type { EstadoAccion } from "@/lib/tipos";

const SIN_PERMISO: EstadoAccion = { error: "Solo el dueño del negocio puede modificar los productos." };
const idValido = (id: string) => z.uuid().safeParse(id).success;

/** Sesión de un dueño con el negocio habilitado, o el error para devolver. */
async function sesionDueno() {
  const sesion = await sesionParaAccion({ soloDueno: true });
  if (!sesion) return { error: SIN_PERMISO.error } as const;
  if (!sesion.habilitado) return { error: MENSAJE_SOLO_LECTURA } as const;
  return { sesion } as const;
}

function revalidar() {
  revalidatePath("/panel/productos", "layout");
}

export async function guardarProducto(id: string | null, _prev: EstadoAccion, formData: FormData): Promise<EstadoAccion> {
  const r = await sesionDueno();
  if ("error" in r) return { error: r.error };
  const { sesion } = r;
  if (id && !idValido(id)) return { error: "Producto inválido." };

  const datos = esquemaProducto.safeParse(datosDeForm(formData));
  if (!datos.success) return { errores: erroresDeCampo(datos.error) };
  const d = datos.data;

  let nuevoId: string | null = null;
  try {
    await comoUsuario(sesion.userId, async (tx) => {
      if (id) {
        const fila = await tx.uno(sql`
          update public.productos
          set nombre = ${d.nombre}, descripcion = ${d.descripcion ?? null}, precio = ${d.precio},
              stock = ${d.stock}, activo = ${d.activo}, orden = ${d.orden}
          where id = ${id} and negocio_id = ${sesion.negocio.id}
          returning id`);
        if (!fila) throw new Error("PRODUCTO_INEXISTENTE");
      } else {
        const fila = await tx.uno<{ id: string }>(sql`
          insert into public.productos (negocio_id, nombre, descripcion, precio, stock, activo, orden)
          values (${sesion.negocio.id}, ${d.nombre}, ${d.descripcion ?? null}, ${d.precio}, ${d.stock}, ${d.activo}, ${d.orden})
          returning id`);
        nuevoId = fila?.id ?? null;
      }
    });
  } catch (e) {
    if (e instanceof Error && e.message === "PRODUCTO_INEXISTENTE") return { error: "Ese producto ya no existe." };
    return { error: mensajeDeError(e) };
  }

  revalidar();
  // Uno nuevo va a su pantalla, así se le puede subir la foto.
  redirect(nuevoId ? `/panel/productos/${nuevoId}?nuevo=1` : "/panel/productos");
}

/** Borrado real: los pedidos conservan nombre y precio (pedido_items.producto_id queda en null). */
export async function borrarProducto(id: string): Promise<EstadoAccion> {
  const r = await sesionDueno();
  if ("error" in r) return { error: r.error };
  if (!idValido(id)) return { error: "Producto inválido." };

  try {
    await comoUsuario(r.sesion.userId, (tx) =>
      tx.ejecutar(sql`delete from public.productos where id = ${id} and negocio_id = ${r.sesion.negocio.id}`),
    );
  } catch (e) {
    return { error: mensajeDeError(e) };
  }

  revalidar();
  redirect("/panel/productos");
}

// --- Foto -------------------------------------------------------------------------------

/** Dueño habilitado y producto de su negocio (RLS). */
async function duenoDelProducto(id: string) {
  const r = await sesionDueno();
  if ("error" in r) return r;
  if (!idValido(id)) return { error: "Producto inválido." } as const;
  const prod = await comoUsuario(r.sesion.userId, (tx) =>
    tx.uno(sql`select id from public.productos where id = ${id} and negocio_id = ${r.sesion.negocio.id}`),
  );
  return prod ? r : ({ error: "Producto inválido." } as const);
}

export async function subirFotoProducto(id: string, formData: FormData): Promise<EstadoAccion> {
  const r = await duenoDelProducto(id);
  if ("error" in r) return { error: r.error };

  const archivo = formData.get("foto");
  if (!(archivo instanceof File) || archivo.size === 0) return { error: "Elegí una imagen." };
  if (archivo.size > PRODUCTO_FOTO_MAX_BYTES) return { error: "La imagen es muy pesada (máximo 512 KB)." };
  const datos = Buffer.from(await archivo.arrayBuffer());
  const tipo = tipoDeImagen(datos);
  if (!tipo) return { error: "Formato no admitido: usá PNG, JPG o WebP." };

  try {
    await guardarFotoProducto(id, tipo, datos);
  } catch (e) {
    return { error: mensajeDeError(e) };
  }
  revalidar();
  return { ok: true, mensaje: "Foto actualizada." };
}

export async function quitarFotoProducto(id: string): Promise<EstadoAccion> {
  const r = await duenoDelProducto(id);
  if ("error" in r) return { error: r.error };
  try {
    await borrarFotoProducto(id);
  } catch (e) {
    return { error: mensajeDeError(e) };
  }
  revalidar();
  return { ok: true, mensaje: "Foto quitada." };
}
