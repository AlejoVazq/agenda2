"use client";

import { useTransition, useState } from "react";
import { BotonEnviar, MensajeAccion, useFormulario } from "@/components/formularios";
import { InputTelefonoLocal } from "@/components/telefono-local";
import { Boton, Campo, Casilla, Input, Textarea, Aviso } from "@/components/ui";
import type { EstadoAccion, Servicio } from "@/lib/tipos";
import { eliminarServicio, guardarServicio } from "./acciones";

const DURACIONES = [15, 20, 30, 45, 60, 75, 90, 120, 150, 180];

/** Quién hace el servicio, con su precio y duración propios (null = los del servicio). */
export type Asignacion = { profesional_id: string; precio: number | null; duracion_min: number | null };

export function FormularioServicio({
  servicio,
  profesionales,
  asignaciones,
}: {
  servicio?: Servicio;
  profesionales: { id: string; nombre: string }[];
  /** Sin servicio (nuevo): todos tildados. */
  asignaciones: Asignacion[];
}) {
  const { estado, accion, valor, marcado, intento } = useFormulario(guardarServicio.bind(null, servicio?.id ?? null));
  const [emergencia, setEmergencia] = useState(marcado("emergencia", servicio?.emergencia ?? false));
  // Lo general se muestra como sugerencia en cada profesional mientras se escribe.
  const [precioGeneral, setPrecioGeneral] = useState(String(valor("precio", servicio?.precio)));
  const [duracionGeneral, setDuracionGeneral] = useState(String(valor("duracion_min", servicio?.duracion_min ?? 60)));

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
            onChange={(e) => setDuracionGeneral(e.target.value)}
            required
          />
          <datalist id="duraciones">
            {DURACIONES.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </Campo>
        <Campo
          etiqueta="Precio ($)"
          htmlFor="precio"
          errores={estado.errores?.precio}
          ayuda={emergencia ? "Opcional. Se muestra en tu página." : "Opcional. Lo cobra quien no tenga uno propio abajo."}
        >
          <Input
            id="precio"
            name="precio"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            defaultValue={valor("precio", servicio?.precio)}
            onChange={(e) => setPrecioGeneral(e.target.value)}
            placeholder="10000"
          />
        </Campo>
      </div>
      {emergencia ? null : (
        <QuienLoHace
          profesionales={profesionales}
          asignaciones={asignaciones}
          nuevo={!servicio}
          precioGeneral={precioGeneral}
          duracionGeneral={duracionGeneral}
          valor={valor}
          marcado={marcado}
          errores={estado.errores ?? {}}
        />
      )}
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

function QuienLoHace({
  profesionales,
  asignaciones,
  nuevo,
  precioGeneral,
  duracionGeneral,
  valor,
  marcado,
  errores,
}: {
  profesionales: { id: string; nombre: string }[];
  asignaciones: Asignacion[];
  nuevo: boolean;
  precioGeneral: string;
  duracionGeneral: string;
  valor: (nombre: string, original?: string | number | null) => string | number;
  marcado: (nombre: string, original: boolean) => boolean;
  errores: Record<string, string[] | undefined>;
}) {
  const porProf = new Map(asignaciones.map((a) => [a.profesional_id, a]));
  const [tildados, setTildados] = useState(
    () => new Set(profesionales.filter((p) => marcado(`hace_${p.id}`, nuevo || porProf.has(p.id))).map((p) => p.id)),
  );

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-tinta">¿Quién lo hace?</legend>
      <p className="text-xs text-zinc-500">
        Si alguien cobra o tarda distinto, cambiá su precio o su duración. Vacío = lo general de arriba.
      </p>
      {profesionales.length === 0 ? (
        <p className="text-sm text-zinc-600">Todavía no cargaste profesionales.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200">
          {profesionales.map((p) => {
            const a = porProf.get(p.id);
            const hace = tildados.has(p.id);
            const error = errores[`precio_${p.id}`]?.[0] ?? errores[`duracion_${p.id}`]?.[0];
            return (
              <li key={p.id} className={hace ? "bg-marca-50/40 px-3 py-2.5" : "px-3 py-2.5"}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <label className="flex min-w-36 flex-1 cursor-pointer items-center gap-2.5">
                    <input
                      type="checkbox"
                      name={`hace_${p.id}`}
                      checked={hace}
                      onChange={(e) =>
                        setTildados((t) => {
                          const n = new Set(t);
                          if (e.target.checked) n.add(p.id);
                          else n.delete(p.id);
                          return n;
                        })
                      }
                      className="size-5 shrink-0 rounded-md border-zinc-300 accent-marca-700"
                    />
                    <span className="text-sm font-medium text-tinta">{p.nombre}</span>
                  </label>
                  {hace ? (
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1 text-sm text-zinc-500">
                        $
                        <Input
                          name={`precio_${p.id}`}
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="any"
                          aria-label={`Precio de ${p.nombre}`}
                          defaultValue={valor(`precio_${p.id}`, a?.precio)}
                          placeholder={precioGeneral || "—"}
                          className="w-28! py-1.5!"
                        />
                      </label>
                      <label className="flex items-center gap-1 text-sm text-zinc-500">
                        <Input
                          name={`duracion_${p.id}`}
                          type="number"
                          inputMode="numeric"
                          min={5}
                          max={600}
                          step={5}
                          aria-label={`Duración de ${p.nombre} en minutos`}
                          defaultValue={valor(`duracion_${p.id}`, a?.duracion_min)}
                          placeholder={duracionGeneral}
                          className="w-20! py-1.5!"
                        />
                        min
                      </label>
                    </div>
                  ) : (
                    <span className="text-xs text-zinc-400">No lo hace</span>
                  )}
                </div>
                {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
              </li>
            );
          })}
        </ul>
      )}
    </fieldset>
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
