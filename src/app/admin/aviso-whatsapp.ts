import { formatFechaLarga } from "@/lib/fechas";
import { MARCA } from "@/lib/marca";
import { calcularMembresia, diasHasta, type EstadoSuscripcion, type PeriodoPago } from "@/lib/suscripcion";

// Mensaje de WhatsApp al dueño según en qué momento de la membresía está. El admin lo
// abre desde /admin (wa.me con el texto ya escrito) y lo manda él.

type Datos = {
  nombre: string;
  estado: EstadoSuscripcion;
  created_at: string;
  prueba_hasta: string;
  pagado_hasta: string | null;
  pagos?: PeriodoPago[];
};

/** ¿Conviene avisarle? (está por vencer, en gracia, apagado o dado de baja) */
export function convieneAvisar(n: Datos) {
  if (n.estado === "prueba" || n.estado === "activa") return diasHasta(calcularMembresia(n).vence) <= 7;
  return true;
}

export function textoAvisoWhatsApp(n: Datos, dueno: string | null): string {
  const m = calcularMembresia(n);
  const hola = `¡Hola${dueno ? ` ${dueno.split(" ")[0]}` : ""}! Te escribo de ${MARCA.nombre}.`;
  switch (n.estado) {
    case "prueba":
      return `${hola} La prueba gratis de ${n.nombre} termina el ${formatFechaLarga(m.vence)}. Para seguir usando la agenda y que tu página siga tomando turnos, se contrata el plan mensual. ¿Te paso los datos para el pago?`;
    case "activa":
      return `${hola} El plan de ${n.nombre} vence el ${formatFechaLarga(m.vence)}. Si lo renovás antes, seguís sin ningún corte. ¿Te paso los datos para el pago?`;
    case "gracia":
      return `${hola} El plan de ${n.nombre} venció el ${formatFechaLarga(m.vence)}: el panel quedó en solo lectura, pero tu página sigue tomando reservas hasta el ${formatFechaLarga(m.apagado)}. Si no se renueva, ese día se apaga. ¿Te paso los datos para renovarlo?`;
    case "vencida":
      return `${hola} Como el plan de ${n.nombre} no se renovó, la cuenta se apagó y tu página no está tomando reservas. Tus datos están guardados: apenas lo renueves, vuelve todo como estaba. ¿Te paso los datos para el pago?`;
    case "suspendida":
      return `${hola} La cuenta de ${n.nombre} está dada de baja, así que tu página no está tomando reservas. Tus datos están guardados. Si querés volver a activarla, escribime.`;
  }
}
