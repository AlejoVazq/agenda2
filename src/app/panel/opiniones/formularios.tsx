"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { BotonEnviar, MensajeAccion, useFormulario } from "@/components/formularios";
import { Estrellas } from "@/components/estrellas";
import { clasesBoton, cx, Insignia, Textarea } from "@/components/ui";
import { formatFechaCorta } from "@/lib/fechas";
import type { EstadoAccion } from "@/lib/tipos";
import { activarResenas, ocultarComentario, responderResena } from "./acciones";
import type { OpinionDelPanel } from "./page";

export function InterruptorOpiniones({ activas, slug }: { activas: boolean; slug: string }) {
  const [estado, setEstado] = useState<EstadoAccion>({});
  const [pendiente, iniciar] = useTransition();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">Mostrar y pedir opiniones</p>
          <p className="text-sm text-zinc-600">
            {activas ? (
              <>
                Se ven en{" "}
                <Link href={`/n/${slug}#opiniones`} target="_blank" className="text-marca-700 underline">
                  tu página de reservas
                </Link>{" "}
                y le pedimos la opinión a cada cliente por mail.
              </>
            ) : (
              "Apagadas: no se muestran ni se piden nuevas. Las que ya hay se guardan."
            )}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={activas}
          aria-label="Mostrar y pedir opiniones"
          disabled={pendiente}
          onClick={() => iniciar(async () => setEstado(await activarResenas(!activas)))}
          className={cx(
            "relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-60",
            activas ? "bg-marca-700" : "bg-zinc-300",
          )}
        >
          <span
            className={cx(
              "absolute top-1 size-5 rounded-full bg-white shadow transition-all",
              activas ? "left-6" : "left-1",
            )}
          />
        </button>
      </div>
      <MensajeAccion estado={estado} />
    </div>
  );
}

export function OpinionPanel({ opinion: o, zona }: { opinion: OpinionDelPanel; zona: string }) {
  const [respondiendo, setRespondiendo] = useState(false);
  const [estadoOculto, setEstadoOculto] = useState<EstadoAccion>({});
  const [pendiente, iniciar] = useTransition();
  const { estado, accion, valor, intento } = useFormulario(async (prev: EstadoAccion, formData: FormData) => {
    const r = await responderResena(prev, formData);
    if (r.ok) setRespondiendo(false);
    return r;
  });

  return (
    <article className="rounded-3xl bg-white p-4 shadow-suave ring-1 ring-zinc-200/70 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <p className="font-semibold text-tinta">
            {o.cliente_id ? (
              <Link href={`/panel/clientes/${o.cliente_id}`} className="hover:underline">
                {o.autor}
              </Link>
            ) : (
              o.autor
            )}
          </p>
          <p className="text-xs text-zinc-500">
            {o.servicio} con {o.profesional} · turno del {formatFechaCorta(o.turno_inicio, zona)}
          </p>
        </div>
        <Estrellas valor={o.estrellas} className="size-4.5" />
      </div>

      {o.comentario ? (
        <div className="mt-3">
          {o.comentario_oculto ? (
            <Insignia color="gris">Comentario oculto en tu página</Insignia>
          ) : null}
          <p className={cx("mt-1.5 whitespace-pre-line text-[15px] text-zinc-700", o.comentario_oculto && "text-zinc-400 line-through decoration-zinc-300")}>
            {o.comentario}
          </p>
        </div>
      ) : (
        <p className="mt-3 text-sm italic text-zinc-400">Sin comentario, solo el puntaje.</p>
      )}

      {o.respuesta && !respondiendo ? (
        <div className="mt-3 rounded-xl bg-marca-50/60 px-3.5 py-2.5 text-sm ring-1 ring-marca-100">
          <p className="text-xs font-semibold text-marca-800">Tu respuesta (pública)</p>
          <p className="mt-0.5 whitespace-pre-line text-zinc-700">{o.respuesta}</p>
        </div>
      ) : null}

      {estado.ok && !respondiendo ? <div className="mt-3"><MensajeAccion estado={estado} /></div> : null}
      <MensajeAccion estado={estadoOculto} />

      {respondiendo ? (
        <form key={intento} action={accion} className="mt-3 space-y-2">
          <input type="hidden" name="id" value={o.id} />
          <MensajeAccion estado={estado.ok ? undefined : estado} />
          <Textarea
            name="respuesta"
            rows={3}
            maxLength={600}
            autoFocus
            placeholder="Gracias por venir…"
            defaultValue={valor("respuesta", o.respuesta ?? "")}
            aria-label="Respuesta"
          />
          <p className="text-xs text-zinc-500">Se publica debajo de la opinión. Dejala vacía para borrarla.</p>
          <div className="flex gap-2">
            <BotonEnviar tamano="sm" pendiente="Guardando…">
              Publicar respuesta
            </BotonEnviar>
            <button type="button" onClick={() => setRespondiendo(false)} className={clasesBoton("fantasma", "sm")}>
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => setRespondiendo(true)} className={clasesBoton("secundario", "sm")}>
            {o.respuesta ? "Editar respuesta" : "Responder"}
          </button>
          {o.comentario ? (
            <button
              type="button"
              disabled={pendiente}
              onClick={() => iniciar(async () => setEstadoOculto(await ocultarComentario(o.id, !o.comentario_oculto)))}
              className={clasesBoton("fantasma", "sm")}
            >
              {o.comentario_oculto ? "Mostrar comentario" : "Ocultar comentario"}
            </button>
          ) : null}
        </div>
      )}
    </article>
  );
}
