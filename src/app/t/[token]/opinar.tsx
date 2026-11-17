"use client";

import { useState } from "react";
import { BotonEnviar, MensajeAccion, useFormulario } from "@/components/formularios";
import { Estrellas } from "@/components/estrellas";
import { cx, Textarea } from "@/components/ui";
import type { ResenaDeTurno } from "@/lib/resenas";
import { opinar } from "./acciones";

const ETIQUETAS = ["", "Malo", "Regular", "Bueno", "Muy bueno", "¡Excelente!"];

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
  const [estrellas, setEstrellas] = useState(previa?.estrellas ?? 0);
  const [encima, setEncima] = useState(0);
  const mostrada = encima || estrellas;

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
          <fieldset>
            <legend className="sr-only">Puntaje</legend>
            <div className="flex items-center gap-1" onMouseLeave={() => setEncima(0)}>
              {[1, 2, 3, 4, 5].map((n) => (
                <label
                  key={n}
                  className="cursor-pointer rounded-lg p-0.5 transition active:scale-90 has-focus-visible:ring-2 has-focus-visible:ring-marca-600"
                  onMouseEnter={() => setEncima(n)}
                >
                  <input
                    type="radio"
                    name="estrellas"
                    value={n}
                    checked={estrellas === n}
                    onChange={() => setEstrellas(n)}
                    className="sr-only"
                  />
                  <span className="sr-only">{n} {n === 1 ? "estrella" : "estrellas"}</span>
                  <svg viewBox="0 0 24 24" className={cx("size-10 transition-colors", n <= mostrada ? "text-amber-400" : "text-zinc-200")} aria-hidden>
                    <path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z" fill="currentColor" />
                  </svg>
                </label>
              ))}
              <span className="ml-2 text-sm font-semibold text-zinc-600" aria-live="polite">
                {ETIQUETAS[mostrada]}
              </span>
            </div>
            {estado.errores?.estrellas ? <p className="mt-1 text-sm text-red-700">Elegí de 1 a 5 estrellas.</p> : null}
          </fieldset>
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
