import "server-only";
import type { z } from "zod";
import { comoServidor, sql } from "@/lib/db";
import type { EstadoPedido, MedioPago } from "@/lib/tipos";
import type { esquemaPedido } from "@/lib/validaciones";

// Pedidos de la tienda (migración 0021). Del lado del cliente todo pasa por funciones de
// la base que solo ejecuta el rol del servidor (con el límite por IP en la acción que
// llama). El panel usa comoUsuario y las funciones pedido_* (solo dueños).

export type ItemPedidoPublico = {
  producto_id: string | null;
  nombre: string;
  precio_unitario: number;
  cantidad: number;
};

/** Lo que devuelve `public.ver_pedido` (para /p/<token>). */
export type PedidoPublico = {
  id: string;
  numero: number;
  nombre: string | null;
  email: string;
  telefono: string | null;
  medio: MedioPago;
  /** Un pendiente con el plazo cumplido ya figura vencido. */
  estado: EstadoPedido;
  total: number;
  vence_at: string | null;
  created_at: string;
  pagado_at: string | null;
  entregado_at: string | null;
  cancelado_at: string | null;
  cancelado_por: "cliente" | "negocio" | "sistema" | null;
  items: ItemPedidoPublico[];
  negocio: {
    nombre: string;
    slug: string;
    telefono: string | null;
    direccion: string | null;
    zona_horaria: string;
    transferencia_alias: string | null;
    transferencia_cbu: string | null;
    transferencia_titular: string | null;
  };
  turno: { inicio: string } | null;
};

export type DatosPedido = z.output<typeof esquemaPedido>;

/** El pedido por su token secreto, o null. Los números y fechas vienen de jsonb: se normalizan. */
export async function verPedido(token: string): Promise<PedidoPublico | null> {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const fila = await comoServidor((tx) => tx.uno<{ d: PedidoPublico | null }>(sql`select public.ver_pedido(${token}) as d`));
  const d = fila?.d;
  if (!d) return null;
  return {
    ...d,
    total: Number(d.total),
    items: d.items.map((i) => ({ ...i, precio_unitario: Number(i.precio_unitario), cantidad: Number(i.cantidad) })),
  };
}

/**
 * Crea el pedido (aparta el stock y calcula el total en la base). Errores de la base
 * (traducir con `mensajeDeError`): DATOS_INVALIDOS, NEGOCIO_NO_DISPONIBLE,
 * TIENDA_NO_DISPONIBLE, LIMITE_PEDIDOS, SIN_STOCK.
 */
export async function crearPedido(d: DatosPedido): Promise<{ pedido_id: string; token: string; numero: number; total: number }> {
  const items = JSON.stringify(d.items.map((i) => ({ producto_id: i.producto_id, cantidad: i.cantidad })));
  const fila = await comoServidor((tx) =>
    tx.uno<{ pedido_id: string; token: string; numero: number; total: number }>(sql`
      select * from public.crear_pedido(
        ${d.negocio_id}, ${items}::jsonb, ${d.nombre}, ${d.email}, ${d.telefono}, ${d.medio}, ${d.turno_token ?? null}
      )`),
  );
  if (!fila) throw new Error("crear_pedido no devolvió el pedido");
  return { ...fila, total: Number(fila.total) };
}

/** El cliente cancela un pedido pendiente (vuelve el stock). False si ya no estaba pendiente. */
export async function cancelarPedidoCliente(token: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(token)) return false;
  const fila = await comoServidor((tx) => tx.uno<{ r: boolean }>(sql`select public.cancelar_pedido_cliente(${token}) as r`));
  return fila?.r === true;
}

/** Cron: los pendientes con el plazo cumplido pasan a vencido y devuelven su stock. */
export async function liberarPedidosVencidos(): Promise<number> {
  const fila = await comoServidor((tx) => tx.uno<{ n: number }>(sql`select public.liberar_pedidos_vencidos() as n`));
  return fila?.n ?? 0;
}
