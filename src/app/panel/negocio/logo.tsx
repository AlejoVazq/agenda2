"use client";

import { useRef, useState, useTransition } from "react";
import { MensajeAccion } from "@/components/formularios";
import { clasesBoton, Tarjeta } from "@/components/ui";
import { achicarImagen } from "@/lib/achicar-imagen";
import type { EstadoAccion } from "@/lib/tipos";
import { quitarLogo, subirLogo } from "./acciones";

export function LogoNegocio({ url, nombre }: { url: string | null; nombre: string }) {
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
        imagen = await achicarImagen(archivo);
      } catch {
        setEstado({ error: "No pudimos leer esa imagen. Probá con otra." });
        return;
      }
      const datos = new FormData();
      datos.set("logo", imagen, "logo");
      const r = await subirLogo(datos);
      setEstado(r);
      if (r.ok) setVista(URL.createObjectURL(imagen));
    });
  }

  function quitar() {
    iniciar(async () => {
      const r = await quitarLogo();
      setEstado(r);
      if (r.ok) setVista(null);
    });
  }

  const inicial = nombre.trim().charAt(0).toUpperCase() || "·";

  return (
    <Tarjeta className="space-y-4">
      <div>
        <h2 className="text-lg font-bold">Logo</h2>
        <p className="text-sm text-zinc-600">
          Aparece en tu página de reservas, en tu panel y en la vista previa cuando compartís el link.
        </p>
      </div>
      <MensajeAccion estado={estado} />
      <div className="flex flex-wrap items-center gap-5">
        <div className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-3xl bg-noche ring-1 ring-zinc-200">
          {vista ? (
            // eslint-disable-next-line @next/next/no-img-element -- imagen propia, ya chica (≤512 px)
            <img src={vista} alt={`Logo de ${nombre}`} className="size-full bg-white object-contain p-2" />
          ) : (
            <span className="font-display text-3xl font-bold text-white" aria-hidden>
              {inicial}
            </span>
          )}
        </div>
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={clasesBoton("primario", "md")}
              onClick={() => input.current?.click()}
              disabled={pendiente}
            >
              {pendiente ? "Guardando…" : vista ? "Cambiar logo" : "Subir logo"}
            </button>
            {vista ? (
              <button type="button" className={clasesBoton("secundario", "md")} onClick={quitar} disabled={pendiente}>
                Quitar
              </button>
            ) : null}
          </div>
          <p className="text-xs text-zinc-500">PNG, JPG o WebP. Mejor cuadrado y con fondo transparente o blanco.</p>
        </div>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          tabIndex={-1}
          aria-label="Elegir imagen del logo"
          onChange={elegir}
        />
      </div>
    </Tarjeta>
  );
}
