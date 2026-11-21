"use client";

import { useState } from "react";
import { BotonEnviar, MensajeAccion, useFormulario } from "@/components/formularios";
import { Estrellas } from "@/components/estrellas";
import { SelectorEstrellas } from "@/components/selector-estrellas";
import { cx, Textarea } from "@/components/ui";
import type { ResenaDeTurno } from "@/lib/resenas";
import { opinar } from "./acciones";

export function Opinar({
  token,
  negocio,
  profesional,
  datos,
}: {
  token: string;
  negocio: string;
  profesional: string;
  datos: ResenaDeTurno;
}) {
  const previa = datos.resena;
  const [editando, setEditando] = useState(!previa);
  const { estado, accion, valor, intento } = useFormulario(async (prev, formData: FormData) => {
    const r = await opinar(token, prev, formData);
    if (r.ok) setEditando(false);
    return r;
  });

  return (
    <section
      id="opinar"
      aria-labelledby="t-opinar"
      className="mt-6 scroll-mt-6 animate-aparecer rounded-[2rem] bg-white p-5 shadow-flotante ring-1 ring-zinc-200/60"
    >
      {!editando && previa ? (
        <>
          {estado.ok ? <MensajeAccion estado={estado} /> : null}
          <h2 id="t-opinar" className={cx("font-display text-lg font-bold", estado.ok && "mt-3")}>
            Tu opinión
          </h2>
          <Estrellas valor={previa.estrellas} className="mt-2 size-5" />
          {previa.comentario ? (
            <p className="mt-2 whitespace-pre-line text-zinc-700">{previa.comentario}</p>
          ) : null}
          {previa.oculto ? (
            <p className="mt-1 text-xs text-zinc-500">El negocio ocultó tu comentario; tu puntaje sigue contando.</p>
          ) : null}
          {previa.respuesta ? (
            <div className="mt-3 rounded-xl bg-zinc-50 px-3.5 py-2.5 text-sm ring-1 ring-zinc-100">
              <p className="text-xs font-semibold text-zinc-500">Respuesta de {negocio}</p>
              <p className="mt-0.5 whitespace-pre-line text-zinc-700">{previa.respuesta}</p>
            </div>
          ) : null}
          {datos.puede ? (
            <button
              type="button"
              onClick={() => setEditando(true)}
              className="mt-3 rounded-lg px-2 py-1 text-sm font-semibold text-marca-700 hover:bg-marca-50"
            >
              Editar mi opinión
            </button>
          ) : null}
        </>
      ) : (
        <form key={intento} action={accion} className="space-y-4" noValidate>
          <div>
            <h2 id="t-opinar" className="font-display text-lg font-bold">
              ¿Cómo te fue con {profesional}?
            </h2>
            <p className="text-sm text-zinc-600">Tu opinión ayuda a otros clientes de {negocio}. Se publica con tu nombre y la inicial del apellido.</p>
          </div>
          <MensajeAccion estado={estado.ok ? undefined : estado} />
          <SelectorEstrellas inicial={Number(valor("estrellas", previa?.estrellas ?? 0)) || 0} error={Boolean(estado.errores?.estrellas)} />
          <div>
            <label htmlFor="comentario" className="text-sm font-semibold">
              Contanos más <span className="font-normal text-zinc-500">(opcional)</span>
            </label>
            <Textarea
              id="comentario"
              name="comentario"
              rows={3}
              maxLength={600}
              className="mt-1"
              placeholder="¿Qué te gustó? ¿Qué se podría mejorar?"
              defaultValue={valor("comentario", previa?.comentario ?? "")}
            />
            {estado.errores?.comentario ? <p className="mt-1 text-sm text-red-700">{estado.errores.comentario[0]}</p> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <BotonEnviar className="flex-1" pendiente="Enviando…">
              {previa ? "Guardar cambios" : "Publicar opinión"}
            </BotonEnviar>
            {previa ? (
              <button
                type="button"
                onClick={() => setEditando(false)}
                className="rounded-xl px-4 text-sm font-semibold text-zinc-600 hover:bg-zinc-100"
              >
                Cancelar
              </button>
            ) : null}
          </div>
        </form>
      )}
    </section>
  );
}
