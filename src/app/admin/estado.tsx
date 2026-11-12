import { Insignia } from "@/components/ui";
import { ETIQUETA_ESTADO, type EstadoSuscripcion } from "@/lib/suscripcion";

const COLOR: Record<EstadoSuscripcion, "gris" | "verde" | "violeta" | "ambar" | "rojo"> = {
  prueba: "violeta",
  activa: "verde",
  gracia: "ambar",
  vencida: "rojo",
  suspendida: "gris",
};

export function InsigniaEstado({ estado }: { estado: EstadoSuscripcion }) {
  return <Insignia color={COLOR[estado]}>{ETIQUETA_ESTADO[estado]}</Insignia>;
}
