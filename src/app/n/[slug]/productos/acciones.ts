"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { mensajeDeError } from "@/lib/errores";
import { trasPedidoNuevo } from "@/lib/eventos";
import { dentroDelLimite } from "@/lib/limites";
import { crearPagoPedido } from "@/lib/mercadopago";
import { crearPedido } from "@/lib/pedidos";
import type { EstadoAccion } from "@/lib/tipos";
import { datosDeForm, erroresDeCampo, esquemaPedido } from "@/lib/validaciones";

// Pedido de la tienda: cualquiera puede llamar a esta acción, así que se valida acá y
// además dentro de `crear_pedido` (que no confía en la aplicación: precios, stock, medios).

export async function pedir(_prev: EstadoAccion, formData: FormData): Promise<EstadoAccion> {
  const datos = esquemaPedido.safeParse(datosDeForm(formData));
  if (!datos.success) return { errores: erroresDeCampo(datos.error) };
  const d = datos.data;
  const slug = String(formData.get("slug") ?? "");

  if (!(await dentroDelLimite(`pedido:${d.negocio_id}`, 10, 3600))) {
    return { error: "Hiciste muchos pedidos seguidos. Esperá un rato o comunicate con el negocio." };
  }

  let pedido: Awaited<ReturnType<typeof crearPedido>>;
  try {
    pedido = await crearPedido(d);
  } catch (e) {
    // Sin stock: se vuelve a leer la página para mostrar lo que queda.
    if (e instanceof Error && e.message.includes("SIN_STOCK") && /^[a-z0-9-]{3,50}$/.test(slug)) {
      revalidatePath(`/n/${slug}/productos`);
    }
    if (e instanceof Error && e.message.includes("NEGOCIO_NO_HABILITADO")) {
      return { error: "Este negocio no está tomando pedidos online en este momento. Comunicate con el negocio." };
    }
    return { error: mensajeDeError(e, "No pudimos tomar el pedido. Probá de nuevo.") };
  }

  // El cliente recibe siempre el mail con el link; los dueños, al toque si no es Mercado
  // Pago (con Mercado Pago les llega recién cuando se acredita el pago).
  trasPedidoNuevo(pedido.pedido_id, d.medio);
  if (/^[a-z0-9-]{3,50}$/.test(slug)) revalidatePath(`/n/${slug}`);

  if (d.medio === "mercadopago") {
    const url = await crearPagoPedido(pedido.pedido_id).catch((e) => {
      console.error("[pedido] no se pudo crear el pago", e);
      return null;
    });
    // Si Mercado Pago no respondió, la página del pedido ofrece reintentar el pago.
    redirect(url ?? `/p/${pedido.token}?nuevo=1`);
  }
  redirect(`/p/${pedido.token}?nuevo=1`);
}
