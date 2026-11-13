"use client";

import { useRef, useState, useTransition } from "react";
import { MensajeAccion } from "@/components/formularios";
import { clasesBoton, Tarjeta } from "@/components/ui";
import type { EstadoAccion } from "@/lib/tipos";
import { quitarLogo, subirLogo } from "./acciones";

const LADO_MAX = 512;
const BYTES_MAX = 512 * 1024;

/**
 * Achica la imagen en el navegador (máx. 512 px de lado) y la pasa a PNG, que
 * conserva la transparencia y lo entienden también las vistas previas para compartir.
 * Si el PNG queda muy pesado (fotos), va como JPG.
 */
async function prepararImagen(archivo: File): Promise<Blob> {
  const bitmap = await createImageBitmap(archivo);
  const escala = Math.min(1, LADO_MAX / Math.max(bitmap.width, bitmap.height));
  const lienzo = document.createElement("canvas");
  lienzo.width = Math.max(1, Math.round(bitmap.width * escala));
  lienzo.height = Math.max(1, Math.round(bitmap.height * escala));
  const ctx = lienzo.getContext("2d");
  if (!ctx) throw new Error("sin canvas");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, lienzo.width, lienzo.height);
  bitmap.close();

  const exportar = (tipo: string, calidad?: number) =>
    new Promise<Blob>((ok, mal) => lienzo.toBlob((b) => (b ? ok(b) : mal(new Error("toBlob"))), tipo, calidad));
  const png = await exportar("image/png");
  if (png.size <= BYTES_MAX) return png;
  // JPG no tiene transparencia: fondo blanco.
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, lienzo.width, lienzo.height);
  return exportar("image/jpeg", 0.88);
}

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
        imagen = await prepararImagen(archivo);
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
