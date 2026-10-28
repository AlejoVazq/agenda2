"use client";

import { useActionState, useState, useTransition } from "react";
import { BotonEnviar, MensajeAccion } from "@/components/formularios";
import { Aviso, Boton, Campo, Casilla, Input, cx } from "@/components/ui";
import { formatDuracion } from "@/lib/fechas";
import { DIAS_SEMANA, type EstadoAccion, type Horario, type Profesional, type Servicio } from "@/lib/tipos";
import { eliminarProfesional, guardarHorarios, guardarProfesional, guardarServiciosProfesional } from "./acciones";

const COLORES = ["#7434ee", "#0d9488", "#e11d48", "#ea580c", "#2563eb", "#ca8a04", "#9333ea", "#16a34a"];

export function FormularioProfesional({ profesional }: { profesional?: Profesional }) {
  const [estado, accion] = useActionState(guardarProfesional.bind(null, profesional?.id ?? null), {});
  const [color, setColor] = useState(profesional?.color ?? COLORES[0]);

  return (
    <form action={accion} className="space-y-5" noValidate>
      <MensajeAccion estado={estado} />
      <Campo etiqueta="Nombre" htmlFor="nombre" errores={estado.errores?.nombre}>
        <Input id="nombre" name="nombre" defaultValue={profesional?.nombre} placeholder="Ej: Mica" required />
      </Campo>
      <Campo etiqueta="Email" htmlFor="email" errores={estado.errores?.email} ayuda="Opcional. Para avisos internos.">
        <Input id="email" name="email" type="email" inputMode="email" defaultValue={profesional?.email ?? ""} />
      </Campo>
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-zinc-700">Color en la agenda</legend>
        <input type="hidden" name="color" value={color} />
        <div className="flex flex-wrap gap-2">
          {COLORES.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Color ${c}`}
              aria-pressed={c === color}
              onClick={() => setColor(c)}
              className={cx(
                "size-9 rounded-full ring-offset-2 transition",
                c === color ? "ring-2 ring-tinta" : "hover:scale-110",
              )}
              style={{ background: c }}
            />
          ))}
        </div>
      </fieldset>
      <Casilla
        name="activo"
        defaultChecked={profesional?.activo ?? true}
        etiqueta="Recibe turnos online"
        descripcion="Si lo desactivás, no aparece en tu página de reservas."
      />
      <BotonEnviar tamano="lg" className="w-full sm:w-auto">
        {profesional ? "Guardar datos" : "Crear profesional"}
      </BotonEnviar>
    </form>
  );
}

export function FormularioServiciosProfesional({
  profesionalId,
  servicios,
  asignados,
}: {
  profesionalId: string;
  servicios: Servicio[];
  asignados: string[];
}) {
  const [estado, accion] = useActionState(guardarServiciosProfesional.bind(null, profesionalId), {});

  if (servicios.length === 0) {
    return <p className="text-sm text-zinc-600">Primero cargá servicios en la sección Servicios.</p>;
  }

  return (
    <form action={accion} className="space-y-4">
      <MensajeAccion estado={estado} />
      <div className="grid gap-2 sm:grid-cols-2">
        {servicios.map((s) => (
          <Casilla
            key={s.id}
            name="servicio_id"
            value={s.id}
            defaultChecked={asignados.includes(s.id)}
            etiqueta={s.nombre}
            descripcion={`${formatDuracion(s.duracion_min)}${s.activo ? "" : " · inactivo"}`}
          />
        ))}
      </div>
      <BotonEnviar variante="secundario">Guardar servicios</BotonEnviar>
    </form>
  );
}

type Franja = { dia_semana: number; desde: string; hasta: string };

// Orden de la semana arrancando el lunes.
const ORDEN_DIAS = [1, 2, 3, 4, 5, 6, 0];

export function EditorHorarios({ profesionalId, horarios }: { profesionalId: string; horarios: Horario[] }) {
  const [estado, accion] = useActionState(guardarHorarios.bind(null, profesionalId), {});
  const [franjas, setFranjas] = useState<Franja[]>(
    horarios.map((h) => ({ dia_semana: h.dia_semana, desde: h.desde.slice(0, 5), hasta: h.hasta.slice(0, 5) })),
  );

  const delDia = (d: number) =>
    franjas.map((f, i) => ({ ...f, i })).filter((f) => f.dia_semana === d).sort((a, b) => a.desde.localeCompare(b.desde));

  function agregar(d: number) {
    const existentes = delDia(d);
    const ultima = existentes.at(-1);
    const nueva = ultima
      ? { dia_semana: d, desde: ultima.hasta < "20:00" ? sumarHoras(ultima.hasta, 1) : "18:00", hasta: "20:00" }
      : { dia_semana: d, desde: "09:00", hasta: "18:00" };
    if (nueva.desde >= nueva.hasta) nueva.hasta = "23:59";
    setFranjas([...franjas, nueva]);
  }

  function actualizar(i: number, campo: "desde" | "hasta", valor: string) {
    setFranjas(franjas.map((f, j) => (j === i ? { ...f, [campo]: valor } : f)));
  }

  function quitar(i: number) {
    setFranjas(franjas.filter((_, j) => j !== i));
  }

  function copiarATodos(d: number) {
    const modelo = delDia(d).map(({ desde, hasta }) => ({ desde, hasta }));
    const habiles = [1, 2, 3, 4, 5].filter((x) => x !== d);
    setFranjas([
      ...franjas.filter((f) => !habiles.includes(f.dia_semana)),
      ...habiles.flatMap((x) => modelo.map((m) => ({ ...m, dia_semana: x }))),
    ]);
  }

  return (
    <form action={accion} className="space-y-4">
      <input type="hidden" name="franjas" value={JSON.stringify(franjas)} />
      <MensajeAccion estado={estado} />
      <ul className="divide-y divide-zinc-100 rounded-2xl border border-zinc-200">
        {ORDEN_DIAS.map((d) => {
          const lista = delDia(d);
          return (
            <li key={d} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-start">
              <div className="flex items-center justify-between sm:w-32 sm:pt-2.5">
                <span className={cx("font-semibold", lista.length === 0 && "text-zinc-400")}>{DIAS_SEMANA[d]}</span>
                {lista.length === 0 ? <span className="text-xs text-zinc-400 sm:hidden">Cerrado</span> : null}
              </div>
              <div className="flex-1 space-y-2">
                {lista.map((f) => (
                  <div key={f.i} className="flex items-center gap-2">
                    <Input
                      type="time"
                      aria-label="Desde"
                      value={f.desde}
                      step={300}
                      onChange={(e) => actualizar(f.i, "desde", e.target.value)}
                      className="w-full sm:w-32"
                    />
                    <span className="text-zinc-400">a</span>
                    <Input
                      type="time"
                      aria-label="Hasta"
                      value={f.hasta}
                      step={300}
                      onChange={(e) => actualizar(f.i, "hasta", e.target.value)}
                      className="w-full sm:w-32"
                    />
                    <button
                      type="button"
                      onClick={() => quitar(f.i)}
                      className="grid size-10 shrink-0 place-items-center rounded-lg text-zinc-400 hover:bg-red-50 hover:text-red-600"
                      aria-label="Quitar franja"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <button type="button" onClick={() => agregar(d)} className="text-sm font-semibold text-marca-700 hover:underline">
                    {lista.length === 0 ? "+ Agregar horario" : "+ Otra franja"}
                  </button>
                  {lista.length > 0 && d >= 1 && d <= 5 ? (
                    <button
                      type="button"
                      onClick={() => copiarATodos(d)}
                      className="text-sm font-medium text-zinc-500 hover:text-tinta hover:underline"
                    >
                      Copiar a lunes–viernes
                    </button>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <BotonEnviar>Guardar horarios</BotonEnviar>
    </form>
  );
}

function sumarHoras(hora: string, horas: number) {
  const [h, m] = hora.split(":").map(Number);
  const total = Math.min(h + horas, 23);
  return `${String(total).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function EliminarProfesional({ id }: { id: string }) {
  const [confirmar, setConfirmar] = useState(false);
  const [estado, setEstado] = useState<EstadoAccion>();
  const [pendiente, iniciar] = useTransition();
  return (
    <div className="space-y-3">
      {estado?.error ? <Aviso tipo="error">{estado.error}</Aviso> : null}
      {confirmar ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-zinc-700">¿Seguro? Se borran también sus horarios.</span>
          <Boton
            variante="peligro"
            tamano="sm"
            disabled={pendiente}
            onClick={() => iniciar(async () => setEstado(await eliminarProfesional(id)))}
          >
            {pendiente ? "Eliminando…" : "Sí, eliminar"}
          </Boton>
          <Boton variante="fantasma" tamano="sm" onClick={() => setConfirmar(false)}>
            Cancelar
          </Boton>
        </div>
      ) : (
        <Boton variante="peligro" tamano="sm" onClick={() => setConfirmar(true)}>
          Eliminar profesional
        </Boton>
      )}
    </div>
  );
}
