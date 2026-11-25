"use client";

import { useActionState } from "react";
import { BotonEnviar, MensajeAccion } from "@/components/formularios";
import { pagarPedido } from "./acciones";

export function PagarPedido({ token, monto }: { token: string; monto: string }) {
  const [estado, accion] = useActionState(pagarPedido.bind(null, token), {});
  return (
    <form action={accion} className="space-y-2">
      <MensajeAccion estado={estado} />
      <BotonEnviar tamano="lg" className="w-full bg-sky-600! hover:bg-sky-700! active:bg-sky-800!" pendiente="Abriendo Mercado Pago…">
        Pagar {monto} con Mercado Pago
      </BotonEnviar>
    </form>
  );
}
