"use client";

import { useTransition, useState } from "react";
import { BotonEnviar, MensajeAccion, useFormulario } from "@/components/formularios";
import { InputTelefonoLocal } from "@/components/telefono-local";
import { Boton, Campo, Casilla, Input, Textarea, Aviso } from "@/components/ui";
import type { EstadoAccion, Servicio } from "@/lib/tipos";
import { eliminarServicio, guardarServicio } from "./acciones";

const DURACIONES = [15, 20, 30, 45, 60, 75, 90, 120, 150, 180];

export function FormularioServicio({ servicio }: { servicio?: Servicio }) {
  const { estado, accion, valor, marcado, intento } = useFormulario(guardarServicio.bind(null, servicio?.id ?? null));
  const [emergencia, setEmergencia] = useState(marcado("emergencia", servicio?.emergencia ?? false));

  return (
    <form key={intento} action={accion} className="space-y-5" noValidate>
      <MensajeAccion estado={estado} />
      <Campo etiqueta="Nombre" htmlFor="nombre" errores={estado.errores?.nombre}>
        <Input id="nombre" name="nombre" defaultValue={valor("nombre", servicio?.nombre)} placeholder="Ej: Corte y barba" required />
      </Campo>
      <Casilla
        name="emergencia"
        checked={emergencia}
        onChange={(e) => setEmergencia(e.target.checked)}
        etiqueta="Servicio de emergencia (se coordina por WhatsApp)"
        descripcion="No se reserva en el calendario: tu página muestra el precio y un botón para escribirte."
      />
      {emergencia ? (
        <Campo
          etiqueta="WhatsApp de quien hace el servicio"
          htmlFor="contacto_whatsapp"
          errores={estado.errores?.contacto_whatsapp}
          ayuda="Obligatorio. A este número le escriben los clientes."
        >
          <InputTelefonoLocal
            id="contacto_whatsapp"
            name="contacto_whatsapp"
            defaultValue={String(valor("contacto_whatsapp", servicio?.contacto_whatsapp))}
            required
          />
        </Campo>
      ) : null}
      <div className="grid gap-5 sm:grid-cols-2">
        <Campo
          etiqueta="Duración (minutos)"
          htmlFor="duracion_min"
          errores={estado.errores?.duracion_min}
          ayuda={emergencia ? "Se usa si cargás el turno a mano desde la agenda." : undefined}
        >
          <Input
            id="duracion_min"
            name="duracion_min"
            type="number"
            inputMode="numeric"
            min={5}
            max={600}
            step={5}
            list="duraciones"
            defaultValue={valor("duracion_min", servicio?.duracion_min ?? 60)}
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
            defaultValue={valor("precio", servicio?.precio)}
            placeholder="10000"
          />
        </Campo>
      </div>
      <Campo etiqueta="Descripción" htmlFor="descripcion" errores={estado.errores?.descripcion} ayuda="Opcional.">
        <Textarea id="descripcion" name="descripcion" defaultValue={valor("descripcion", servicio?.descripcion)} rows={3} />
      </Campo>
      <Casilla
        name="activo"
        defaultChecked={marcado("activo", servicio?.activo ?? true)}
        etiqueta="Mostrar en tu página"
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
