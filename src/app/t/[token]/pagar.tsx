"use client";

import { useActionState } from "react";
import { BotonEnviar, MensajeAccion } from "@/components/formularios";
import { pagarSena } from "./acciones";

export function PagarSena({ token, monto }: { token: string; monto: string }) {
  const [estado, accion] = useActionState(pagarSena.bind(null, token), {});
  return (
    <form action={accion} className="space-y-2">
      <MensajeAccion estado={estado} />
      <BotonEnviar tamano="lg" className="w-full bg-sky-600 hover:bg-sky-700 active:bg-sky-800" pendiente="Abriendo Mercado Pago…">
        Pagar seña de {monto} con Mercado Pago
      </BotonEnviar>
    </form>
  );
}
