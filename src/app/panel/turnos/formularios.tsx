"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BotonEnviar, MensajeAccion } from "@/components/formularios";
import { Aviso, Boton, Campo, Input, Textarea } from "@/components/ui";
import type { EstadoAccion, EstadoTurno } from "@/lib/tipos";
import { cambiarEstadoTurno } from "../agenda/acciones";
import { guardarNotas, reprogramarTurno } from "./acciones";

export function AccionesEstado({ id, estado }: { id: string; estado: EstadoTurno }) {
  const router = useRouter();
  const [resultado, setResultado] = useState<EstadoAccion>();
  const [pendiente, iniciar] = useTransition();
  const [confirmarCancelacion, setConfirmarCancelacion] = useState(false);

  function cambiar(nuevo: EstadoTurno) {
    iniciar(async () => {
      const r = await cambiarEstadoTurno({ id, estado: nuevo });
      setResultado(r);
      setConfirmarCancelacion(false);
      if (!r.error) router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {resultado?.error ? <Aviso tipo="error">{resultado.error}</Aviso> : null}
      <div className="flex flex-wrap gap-2">
        {estado === "pendiente" ? (
          <Boton disabled={pendiente} onClick={() => cambiar("confirmado")}>
            Confirmar
          </Boton>
        ) : null}
        {estado === "confirmado" ? (
          <Boton variante="secundario" disabled={pendiente} onClick={() => cambiar("completado")}>
            Marcar como atendido
          </Boton>
        ) : null}
        {estado === "completado" ? (
          <Boton variante="secundario" disabled={pendiente} onClick={() => cambiar("confirmado")}>
            Deshacer “atendido”
          </Boton>
        ) : null}
        {estado === "cancelado" ? (
          <Boton variante="secundario" disabled={pendiente} onClick={() => cambiar("confirmado")}>
            Reactivar turno
          </Boton>
        ) : null}
        {(estado === "pendiente" || estado === "confirmado") &&
          (confirmarCancelacion ? (
            <>
              <Boton variante="peligro" disabled={pendiente} onClick={() => cambiar("cancelado")}>
                Sí, cancelar
              </Boton>
              <Boton variante="fantasma" onClick={() => setConfirmarCancelacion(false)}>
                No
              </Boton>
            </>
          ) : (
            <Boton variante="peligro" onClick={() => setConfirmarCancelacion(true)}>
              Cancelar turno
            </Boton>
          ))}
      </div>
    </div>
  );
}

export function FormularioReprogramar({ id, fecha, hora }: { id: string; fecha: string; hora: string }) {
  const [estado, accion] = useActionState(reprogramarTurno.bind(null, id), {});
  return (
    <form action={accion} className="space-y-3" noValidate>
      <MensajeAccion estado={estado} />
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Nuevo día" htmlFor="r-fecha" errores={estado.errores?.fecha}>
          <Input id="r-fecha" name="fecha" type="date" defaultValue={fecha} required />
        </Campo>
        <Campo etiqueta="Nueva hora" htmlFor="r-hora" errores={estado.errores?.hora}>
          <Input id="r-hora" name="hora" type="time" step={300} defaultValue={hora} required />
        </Campo>
      </div>
      <BotonEnviar variante="secundario">Reprogramar</BotonEnviar>
    </form>
  );
}

export function FormularioNotas({ id, notas }: { id: string; notas: string | null }) {
  const [estado, accion] = useActionState(guardarNotas.bind(null, id), {});
  return (
    <form action={accion} className="space-y-3" noValidate>
      <MensajeAccion estado={estado} />
      <Campo etiqueta="Notas internas" htmlFor="notas" errores={estado.errores?.notas} ayuda="El cliente no las ve.">
        <Textarea id="notas" name="notas" rows={3} defaultValue={notas ?? ""} />
      </Campo>
      <BotonEnviar variante="secundario">Guardar notas</BotonEnviar>
    </form>
  );
}
