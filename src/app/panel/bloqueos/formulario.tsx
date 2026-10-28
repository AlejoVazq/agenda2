"use client";

import { useTransition } from "react";
import { BotonEnviar, MensajeAccion, useFormulario } from "@/components/formularios";
import { Campo, Input, Select } from "@/components/ui";
import type { Profesional } from "@/lib/tipos";
import { crearBloqueo, eliminarBloqueo } from "./acciones";

export function FormularioBloqueo({
  profesionales,
  fijo,
  hoy,
}: {
  profesionales: Pick<Profesional, "id" | "nombre">[];
  fijo?: string;
  hoy: string;
}) {
  const { estado, accion, valor, intento } = useFormulario(crearBloqueo);
  const e = estado.errores ?? {};
  return (
    <form key={intento} action={accion} className="space-y-4" noValidate>
      <MensajeAccion estado={estado} />
      {fijo ? (
        <input type="hidden" name="profesional_id" value={fijo} />
      ) : (
        <Campo etiqueta="Profesional" htmlFor="profesional_id" errores={e.profesional_id}>
          <Select id="profesional_id" name="profesional_id" defaultValue={valor("profesional_id", profesionales[0]?.id)} required>
            {profesionales.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </Select>
        </Campo>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Desde" htmlFor="desde" errores={e.desde}>
          <Input id="desde" name="desde" type="datetime-local" defaultValue={valor("desde", `${hoy}T09:00`)} required />
        </Campo>
        <Campo etiqueta="Hasta" htmlFor="hasta" errores={e.hasta}>
          <Input id="hasta" name="hasta" type="datetime-local" defaultValue={valor("hasta", `${hoy}T20:00`)} required />
        </Campo>
      </div>
      <Campo etiqueta="Motivo" htmlFor="motivo" errores={e.motivo} ayuda="Opcional. No lo ven los clientes.">
        <Input id="motivo" name="motivo" defaultValue={valor("motivo")} placeholder="Vacaciones, trámite, capacitación…" />
      </Campo>
      <BotonEnviar>Guardar ausencia</BotonEnviar>
    </form>
  );
}

export function BotonEliminarBloqueo({ id }: { id: string }) {
  const [pendiente, iniciar] = useTransition();
  return (
    <button
      type="button"
      disabled={pendiente}
      onClick={() => iniciar(async () => void (await eliminarBloqueo(id)))}
      className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
    >
      {pendiente ? "Quitando…" : "Quitar"}
    </button>
  );
}
