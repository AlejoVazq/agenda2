import { Insignia } from "@/components/ui";
import { ESTADOS_PEDIDO, type EstadoPedido } from "@/lib/tipos";

const COLOR = {
  pendiente: "ambar",
  pagado: "verde",
  entregado: "gris",
  cancelado: "rojo",
  vencido: "gris",
  reembolsar: "rojo",
} as const;

export function InsigniaPedido({ estado }: { estado: EstadoPedido }) {
  return <Insignia color={COLOR[estado]}>{ESTADOS_PEDIDO[estado]}</Insignia>;
}
