"use client";

import { useRef, useState, useTransition } from "react";
import { MensajeAccion } from "@/components/formularios";
import { MiniaturaProducto } from "@/components/miniatura-producto";
import { clasesBoton } from "@/components/ui";
import { achicarImagen } from "@/lib/achicar-imagen";
import type { EstadoAccion } from "@/lib/tipos";
import { quitarFotoProducto, subirFotoProducto } from "../acciones";

/** Foto del producto: se ve en la tienda de tu página y en el panel. */
export function FotoProducto({ productoId, nombre, url }: { productoId: string; nombre: string; url: string | null }) {
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
      const r = await subirFotoProducto(productoId, datos);
      setEstado(r);
      if (r.ok) setVista(URL.createObjectURL(imagen));
    });
  }

  function quitar() {
    iniciar(async () => {
      const r = await quitarFotoProducto(productoId);
      setEstado(r);
      if (r.ok) setVista(null);
    });
  }

  return (
    <div className="space-y-3">
      <MensajeAccion estado={estado} />
      <div className="flex flex-wrap items-center gap-4">
        <MiniaturaProducto nombre={nombre} url={vista} className="size-24 rounded-2xl text-3xl" />
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
          <p className="text-xs text-zinc-500">PNG, JPG o WebP. Se ve en la tienda de tu página.</p>
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
