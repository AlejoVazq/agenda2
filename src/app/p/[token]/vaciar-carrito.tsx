"use client";

import { useEffect } from "react";

/** Recién hecho el pedido: el carrito de la tienda de ese negocio ya no hace falta. */
export function VaciarCarrito({ slug }: { slug: string }) {
  useEffect(() => {
    try {
      localStorage.removeItem(`carrito:${slug}`);
    } catch {
      // Sin almacenamiento: no había nada guardado.
    }
  }, [slug]);
  return null;
}
