"use client";

import { useActionState, useState } from "react";
import { BotonEnviar, MensajeAccion } from "@/components/formularios";
import { Campo, Input, Select, Textarea } from "@/components/ui";
import { formatDuracion } from "@/lib/fechas";
import type { EstadoAccion, Profesional, Servicio } from "@/lib/tipos";
import { crearTurnoPanel } from "./acciones";

export type ValoresIniciales = { fecha: string; hora: string; profesional_id?: string };

export function FormularioTurno({
  profesionales,
  servicios,
  asignaciones,
  inicial,
  onListo,
}: {
  profesionales: Pick<Profesional, "id" | "nombre">[];
  servicios: Pick<Servicio, "id" | "nombre" | "duracion_min">[];
  asignaciones: { profesional_id: string; servicio_id: string }[];
  inicial: ValoresIniciales;
  onListo: () => void;
}) {
  const [estado, accion] = useActionState(async (prev: EstadoAccion, formData: FormData) => {
    const r = await crearTurnoPanel(prev, formData);
    if (r.ok) onListo();
    return r;
  }, {});
  const [profesionalId, setProfesionalId] = useState(inicial.profesional_id ?? profesionales[0]?.id ?? "");
  const e = estado.errores ?? {};

  // Primero los servicios que hace el profesional elegido.
  const hace = new Set(asignaciones.filter((a) => a.profesional_id === profesionalId).map((a) => a.servicio_id));
  const ordenados = [...servicios].sort((a, b) => Number(hace.has(b.id)) - Number(hace.has(a.id)));

  return (
    <form action={accion} className="space-y-4" noValidate>
      <MensajeAccion estado={estado} />
      {profesionales.length > 1 ? (
        <Campo etiqueta="Profesional" htmlFor="t-prof" errores={e.profesional_id}>
          <Select id="t-prof" name="profesional_id" value={profesionalId} onChange={(ev) => setProfesionalId(ev.target.value)}>
            {profesionales.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </Select>
        </Campo>
      ) : (
        <input type="hidden" name="profesional_id" value={profesionalId} />
      )}
      <Campo etiqueta="Servicio" htmlFor="t-serv" errores={e.servicio_id}>
        <Select id="t-serv" name="servicio_id" required>
          {ordenados.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nombre} ({formatDuracion(s.duracion_min)}){hace.size && !hace.has(s.id) ? " · no lo hace" : ""}
            </option>
          ))}
        </Select>
      </Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Día" htmlFor="t-fecha" errores={e.fecha}>
          <Input id="t-fecha" name="fecha" type="date" defaultValue={inicial.fecha} required />
        </Campo>
        <Campo etiqueta="Hora" htmlFor="t-hora" errores={e.hora}>
          <Input id="t-hora" name="hora" type="time" step={300} defaultValue={inicial.hora} required />
        </Campo>
      </div>
      <Campo etiqueta="Cliente" htmlFor="t-cli" errores={e.cliente_nombre}>
        <Input id="t-cli" name="cliente_nombre" autoComplete="off" placeholder="Nombre y apellido" required />
      </Campo>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Celular" htmlFor="t-tel" errores={e.cliente_telefono}>
          <Input id="t-tel" name="cliente_telefono" type="tel" inputMode="tel" placeholder="341 555 1234" required />
        </Campo>
        <Campo etiqueta="Email" htmlFor="t-mail" errores={e.cliente_email} ayuda="Opcional">
          <Input id="t-mail" name="cliente_email" type="email" inputMode="email" />
        </Campo>
      </div>
      <Campo etiqueta="Notas" htmlFor="t-notas" errores={e.notas} ayuda="Opcional, solo las ve el negocio.">
        <Textarea id="t-notas" name="notas" rows={2} className="min-h-0" />
      </Campo>
      <BotonEnviar className="w-full" tamano="lg" pendiente="Agendando…">
        Agendar turno
      </BotonEnviar>
    </form>
  );
}
