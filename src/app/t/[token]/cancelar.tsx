"use client";

import { useActionState, useState } from "react";
import { BotonEnviar, MensajeAccion } from "@/components/formularios";
import { Boton } from "@/components/ui";
import { cancelarTurno } from "./acciones";

export function CancelarTurno({ token }: { token: string }) {
  const [estado, accion] = useActionState(cancelarTurno.bind(null, token), {});
  const [confirmar, setConfirmar] = useState(false);

  if (estado.ok) return <MensajeAccion estado={estado} />;

  return (
    <div className="space-y-3">
      <MensajeAccion estado={estado} />
      {confirmar ? (
        <form action={accion} className="flex flex-col gap-2 sm:flex-row">
          <BotonEnviar variante="peligro" className="flex-1" pendiente="Cancelando…">
            Sí, cancelar mi turno
          </BotonEnviar>
          <Boton type="button" variante="secundario" className="flex-1" onClick={() => setConfirmar(false)}>
            No, mantenerlo
          </Boton>
        </form>
      ) : (
        <Boton variante="peligro" className="w-full" onClick={() => setConfirmar(true)}>
          Cancelar turno
        </Boton>
      )}
    </div>
  );
}
