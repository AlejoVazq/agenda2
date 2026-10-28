"use client";

import { useActionState, useTransition, useState } from "react";
import { BotonEnviar, MensajeAccion } from "@/components/formularios";
import { Boton, Campo, Casilla, Input, Textarea, Aviso } from "@/components/ui";
import type { EstadoAccion, Servicio } from "@/lib/tipos";
import { eliminarServicio, guardarServicio } from "./acciones";

const DURACIONES = [15, 20, 30, 45, 60, 75, 90, 120, 150, 180];

export function FormularioServicio({ servicio }: { servicio?: Servicio }) {
  const [estado, accion] = useActionState(guardarServicio.bind(null, servicio?.id ?? null), {});

  return (
    <form action={accion} className="space-y-5" noValidate>
      <MensajeAccion estado={estado} />
      <Campo etiqueta="Nombre" htmlFor="nombre" errores={estado.errores?.nombre}>
        <Input id="nombre" name="nombre" defaultValue={servicio?.nombre} placeholder="Ej: Corte y brushing" required />
      </Campo>
      <div className="grid gap-5 sm:grid-cols-2">
        <Campo etiqueta="Duración (minutos)" htmlFor="duracion_min" errores={estado.errores?.duracion_min}>
          <Input
            id="duracion_min"
            name="duracion_min"
            type="number"
            inputMode="numeric"
            min={5}
            max={600}
            step={5}
            list="duraciones"
            defaultValue={servicio?.duracion_min ?? 60}
            required
          />
          <datalist id="duraciones">
            {DURACIONES.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </Campo>
        <Campo etiqueta="Precio ($)" htmlFor="precio" errores={estado.errores?.precio} ayuda="Opcional. Se muestra al reservar.">
          <Input
            id="precio"
            name="precio"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            defaultValue={servicio?.precio ?? ""}
            placeholder="10000"
          />
        </Campo>
      </div>
      <Campo etiqueta="Descripción" htmlFor="descripcion" errores={estado.errores?.descripcion} ayuda="Opcional.">
        <Textarea id="descripcion" name="descripcion" defaultValue={servicio?.descripcion ?? ""} rows={3} />
      </Campo>
      <Casilla
        name="activo"
        defaultChecked={servicio?.activo ?? true}
        etiqueta="Disponible para reservar online"
        descripcion="Si lo desactivás, deja de aparecer en tu página pero se conservan los turnos."
      />
      <BotonEnviar tamano="lg" className="w-full sm:w-auto">
        {servicio ? "Guardar cambios" : "Crear servicio"}
      </BotonEnviar>
    </form>
  );
}

export function EliminarServicio({ id }: { id: string }) {
  const [confirmar, setConfirmar] = useState(false);
  const [estado, setEstado] = useState<EstadoAccion>();
  const [pendiente, iniciar] = useTransition();

  return (
    <div className="space-y-3">
      {estado?.error ? <Aviso tipo="error">{estado.error}</Aviso> : null}
      {confirmar ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-zinc-700">¿Seguro? No se puede deshacer.</span>
          <Boton
            variante="peligro"
            tamano="sm"
            disabled={pendiente}
            onClick={() => iniciar(async () => setEstado(await eliminarServicio(id)))}
          >
            {pendiente ? "Eliminando…" : "Sí, eliminar"}
          </Boton>
          <Boton variante="fantasma" tamano="sm" onClick={() => setConfirmar(false)}>
            Cancelar
          </Boton>
        </div>
      ) : (
        <Boton variante="peligro" tamano="sm" onClick={() => setConfirmar(true)}>
          Eliminar servicio
        </Boton>
      )}
    </div>
  );
}
