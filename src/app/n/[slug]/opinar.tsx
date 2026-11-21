"use client";

import { useState } from "react";
import { BotonEnviar, MensajeAccion, useFormulario } from "@/components/formularios";
import { SelectorEstrellas } from "@/components/selector-estrellas";
import { Input, Select, Textarea } from "@/components/ui";
import type { EstadoAccion } from "@/lib/tipos";
import { opinarSinTurno } from "./acciones";

/** "Dejar una opinión" en la página del negocio: cualquiera, sin turno ni cuenta. */
export function OpinarSinTurno({
  negocioId,
  slug,
  profesionales,
}: {
  negocioId: string;
  slug: string;
  profesionales: { id: string; nombre: string }[];
}) {
  const [abierto, setAbierto] = useState(false);
  const { estado, accion, valor, intento } = useFormulario(async (prev: EstadoAccion, formData: FormData) => {
    const r = await opinarSinTurno(slug, prev, formData);
    if (r.ok) setAbierto(false);
    return r;
  });

  if (!abierto) {
    return (
      <div className="space-y-3">
        {estado.ok ? <MensajeAccion estado={estado} /> : null}
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-marca-700 text-sm font-semibold text-white transition hover:bg-marca-800"
        >
          <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
            <path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z" fill="currentColor" />
          </svg>
          Dejar una opinión
        </button>
      </div>
    );
  }

  return (
    <form key={intento} action={accion} className="space-y-4 rounded-2xl bg-zinc-50 p-4 ring-1 ring-zinc-100" noValidate>
      <input type="hidden" name="negocio_id" value={negocioId} />
      {/* Trampa para bots: una persona no lo ve ni lo completa. */}
      <input type="text" name="sitio" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
      <div>
        <p className="font-display text-lg font-bold">Tu opinión</p>
        <p className="text-sm text-zinc-600">Se publica con tu nombre y la inicial del apellido.</p>
      </div>
      <MensajeAccion estado={estado.ok ? undefined : estado} />
      <SelectorEstrellas inicial={Number(valor("estrellas", 0)) || 0} error={Boolean(estado.errores?.estrellas)} />
      <div>
        <label htmlFor="opinion-nombre" className="text-sm font-semibold">
          Tu nombre
        </label>
        <Input
          id="opinion-nombre"
          name="nombre"
          maxLength={60}
          autoComplete="name"
          className="mt-1"
          placeholder="Ej.: Martina Gómez"
          defaultValue={valor("nombre")}
          aria-invalid={Boolean(estado.errores?.nombre)}
        />
        {estado.errores?.nombre ? <p className="mt-1 text-sm text-red-700">{estado.errores.nombre[0]}</p> : null}
      </div>
      {profesionales.length > 1 ? (
        <div>
          <label htmlFor="opinion-profesional" className="text-sm font-semibold">
            ¿Con quién te atendiste? <span className="font-normal text-zinc-500">(opcional)</span>
          </label>
          <Select id="opinion-profesional" name="profesional_id" className="mt-1" defaultValue={valor("profesional_id")}>
            <option value="">No sé / prefiero no decir</option>
            {profesionales.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      <div>
        <label htmlFor="opinion-comentario" className="text-sm font-semibold">
          Contanos más <span className="font-normal text-zinc-500">(opcional)</span>
        </label>
        <Textarea
          id="opinion-comentario"
          name="comentario"
          rows={3}
          maxLength={600}
          className="mt-1"
          placeholder="¿Qué te gustó? ¿Qué se podría mejorar?"
          defaultValue={valor("comentario")}
        />
        {estado.errores?.comentario ? <p className="mt-1 text-sm text-red-700">{estado.errores.comentario[0]}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <BotonEnviar className="flex-1" pendiente="Enviando…">
          Publicar opinión
        </BotonEnviar>
        <button
          type="button"
          onClick={() => setAbierto(false)}
          className="rounded-xl px-4 text-sm font-semibold text-zinc-600 hover:bg-zinc-100"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
