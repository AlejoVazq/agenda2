"use client";

import { useRef, useState, useTransition } from "react";
import { MensajeAccion } from "@/components/formularios";
import { clasesBoton } from "@/components/ui";
import { achicarImagen } from "@/lib/achicar-imagen";
import type { EstadoAccion } from "@/lib/tipos";
import { quitarFotoProfesional, subirFotoProfesional } from "../acciones";

/** Foto del profesional: solo se ve en el panel. */
export function FotoProfesional({
  profesionalId,
  nombre,
  color,
  url,
}: {
  profesionalId: string;
  nombre: string;
  color: string;
  url: string | null;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [estado, setEstado] = useState<EstadoAccion>({});
  const [vista, setVista] = useState<string | null>(url);
  const [pendiente, iniciar] = useTransition();

  function elegir(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    e.target.value = "";
    if (!archivo) return;
    if (!/^image\/(png|jpeg|webp)$/.test(archivo.type)) {
      setEstado({ error: "Formato no admitido: usá PNG, JPG o WebP." });
      return;
    }
    iniciar(async () => {
      let imagen: Blob;
      try {
        imagen = await achicarImagen(archivo, { foto: true });
      } catch {
        setEstado({ error: "No pudimos leer esa imagen. Probá con otra." });
        return;
      }
      const datos = new FormData();
      datos.set("foto", imagen, "foto");
      const r = await subirFotoProfesional(profesionalId, datos);
      setEstado(r);
      if (r.ok) setVista(URL.createObjectURL(imagen));
    });
  }

  function quitar() {
    iniciar(async () => {
      const r = await quitarFotoProfesional(profesionalId);
      setEstado(r);
      if (r.ok) setVista(null);
    });
  }

  return (
    <div className="space-y-3">
      <MensajeAccion estado={estado} />
      <div className="flex flex-wrap items-center gap-4">
        {vista ? (
          // eslint-disable-next-line @next/next/no-img-element -- imagen propia, ya chica (≤512 px)
          <img src={vista} alt={`Foto de ${nombre}`} className="size-20 shrink-0 rounded-full object-cover ring-1 ring-zinc-200" />
        ) : (
          <span
            className="grid size-20 shrink-0 place-items-center rounded-full font-display text-2xl font-bold text-white"
            style={{ background: color }}
            aria-hidden
          >
            {nombre.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={clasesBoton("secundario", "sm")}
              onClick={() => input.current?.click()}
              disabled={pendiente}
            >
              {pendiente ? "Guardando…" : vista ? "Cambiar foto" : "Subir foto"}
            </button>
            {vista ? (
              <button type="button" className={clasesBoton("fantasma", "sm")} onClick={quitar} disabled={pendiente}>
                Quitar
              </button>
            ) : null}
          </div>
          <p className="text-xs text-zinc-500">PNG, JPG o WebP. Se ve solo en tu panel.</p>
        </div>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          tabIndex={-1}
          aria-label={`Elegir foto de ${nombre}`}
          onChange={elegir}
        />
      </div>
    </div>
  );
}
