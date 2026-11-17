"use client";

import { useRef, useState, useTransition } from "react";
import { MensajeAccion } from "@/components/formularios";
import { clasesBoton, cx, Tarjeta } from "@/components/ui";
import { COLOR_MARCA, COLORES_SUGERIDOS, colorLegible, esColorHex, estiloTema } from "@/lib/apariencia";
import type { EstadoAccion } from "@/lib/tipos";
import { guardarColor, quitarPortada, subirPortada } from "./acciones";

const ANCHO_MAX = 1600;
const BYTES_MAX = 900 * 1024;

/**
 * Achica la foto en el navegador (máx. 1600 px de ancho) y la pasa a JPG. Si queda pesada,
 * baja la calidad hasta entrar en el límite.
 */
async function prepararPortada(archivo: File): Promise<Blob> {
  const bitmap = await createImageBitmap(archivo);
  const escala = Math.min(1, ANCHO_MAX / bitmap.width, ANCHO_MAX / bitmap.height);
  const lienzo = document.createElement("canvas");
  lienzo.width = Math.max(1, Math.round(bitmap.width * escala));
  lienzo.height = Math.max(1, Math.round(bitmap.height * escala));
  const ctx = lienzo.getContext("2d");
  if (!ctx) throw new Error("sin canvas");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, lienzo.width, lienzo.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, lienzo.width, lienzo.height);
  bitmap.close();

  const exportar = (calidad: number) =>
    new Promise<Blob>((ok, mal) => lienzo.toBlob((b) => (b ? ok(b) : mal(new Error("toBlob"))), "image/jpeg", calidad));
  for (const calidad of [0.82, 0.72, 0.6, 0.5]) {
    const jpg = await exportar(calidad);
    if (jpg.size <= BYTES_MAX) return jpg;
  }
  throw new Error("muy pesada");
}

export function AparienciaNegocio({
  nombre,
  logo,
  portada: portadaInicial,
  color: colorInicial,
}: {
  nombre: string;
  logo: string | null;
  portada: string | null;
  color: string | null;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [estado, setEstado] = useState<EstadoAccion>({});
  const [portada, setPortada] = useState(portadaInicial);
  const [guardado, setGuardado] = useState(colorInicial);
  const [color, setColor] = useState(colorInicial);
  const [pendiente, iniciar] = useTransition();

  const legible = color === null || colorLegible(color);
  const cambioColor = color !== guardado;
  const tema = estiloTema(color);

  function elegirFoto(e: React.ChangeEvent<HTMLInputElement>) {
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
        imagen = await prepararPortada(archivo);
      } catch {
        setEstado({ error: "No pudimos usar esa imagen. Probá con otra." });
        return;
      }
      const datos = new FormData();
      datos.set("portada", imagen, "portada.jpg");
      const r = await subirPortada(datos);
      setEstado(r);
      if (r.ok) setPortada(URL.createObjectURL(imagen));
    });
  }

  function sacarFoto() {
    iniciar(async () => {
      const r = await quitarPortada();
      setEstado(r);
      if (r.ok) setPortada(null);
    });
  }

  function guardar() {
    iniciar(async () => {
      const r = await guardarColor(color);
      setEstado(r);
      if (r.ok) setGuardado(color);
    });
  }

  return (
    <Tarjeta className="space-y-5">
      <div>
        <h2 className="text-lg font-bold">Tu página de reservas</h2>
        <p className="text-sm text-zinc-600">La foto de portada va de fondo arriba de todo; el color, en la cabecera y los botones.</p>
      </div>
      <MensajeAccion estado={estado} />

      {/* Vista previa: las mismas clases que /n/[slug]. */}
      <div className={cx("overflow-hidden rounded-2xl bg-fondo ring-1 ring-zinc-200", tema && "tema-negocio")} style={tema}>
        <div
          className={cx(
            "relative px-4 pb-10 text-white",
            portada ? "pt-14" : "pt-5",
            tema ? "cabecera-tema" : "bg-noche bg-[radial-gradient(ellipse_70%_90%_at_100%_0%,rgb(79_146_114/0.55),transparent)]",
          )}
        >
          {portada ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- vista previa de la imagen propia */}
              <img src={portada} alt="" className="absolute inset-0 size-full object-cover" />
              <div className="velo-portada absolute inset-0" aria-hidden />
            </>
          ) : null}
          <div className="relative flex items-center gap-3">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- imagen propia, ya chica (≤512 px)
              <img src={logo} alt="" className="size-11 rounded-xl bg-white object-contain p-1" />
            ) : (
              <span className="grid size-11 place-items-center rounded-xl bg-white/10 font-display font-bold ring-1 ring-white/20">
                {nombre.trim().charAt(0).toUpperCase() || "·"}
              </span>
            )}
            <p className="truncate font-display text-xl font-bold">{nombre}</p>
          </div>
        </div>
        <div className="relative mx-3 -mt-6 mb-3 space-y-2 rounded-2xl bg-white p-3 shadow-suave">
          <p className="text-xs font-semibold text-zinc-500">Elegí un horario</p>
          <div className="flex gap-2">
            <span className="rounded-lg bg-marca-700 px-3 py-1.5 text-xs font-semibold text-white">10:00</span>
            <span className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-marca-900">10:30</span>
            <span className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-marca-900">11:00</span>
          </div>
        </div>
      </div>

      <section className="space-y-2">
        <h3 className="font-bold">Foto de portada</h3>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={clasesBoton("primario", "md")}
            onClick={() => input.current?.click()}
            disabled={pendiente}
          >
            {pendiente ? "Guardando…" : portada ? "Cambiar foto" : "Subir foto"}
          </button>
          {portada ? (
            <button type="button" className={clasesBoton("secundario", "md")} onClick={sacarFoto} disabled={pendiente}>
              Quitar
            </button>
          ) : null}
        </div>
        <p className="text-xs text-zinc-500">
          PNG, JPG o WebP. Mejor apaisada (por ejemplo, una foto del local): se recorta para llenar el ancho.
        </p>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          tabIndex={-1}
          aria-label="Elegir la foto de portada"
          onChange={elegirFoto}
        />
      </section>

      <section className="space-y-3">
        <h3 className="font-bold">Color</h3>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Color de la página">
          {COLORES_SUGERIDOS.map((c) => {
            const activo = color === c.color;
            return (
              <button
                key={c.nombre}
                type="button"
                role="radio"
                aria-checked={activo}
                title={c.nombre}
                onClick={() => setColor(c.color)}
                className={cx(
                  "size-10 rounded-full ring-offset-2 transition",
                  activo ? "ring-2 ring-tinta" : "ring-1 ring-zinc-200 hover:ring-zinc-400",
                )}
                style={{ backgroundColor: c.color ?? COLOR_MARCA }}
              >
                <span className="sr-only">{c.nombre}</span>
              </button>
            );
          })}
          <label
            className={cx(
              "relative grid size-10 cursor-pointer place-items-center overflow-hidden rounded-full ring-offset-2",
              color && !COLORES_SUGERIDOS.some((c) => c.color === color) ? "ring-2 ring-tinta" : "ring-1 ring-zinc-200",
            )}
            style={{ background: "conic-gradient(#ef4444, #eab308, #22c55e, #06b6d4, #3b82f6, #a855f7, #ef4444)" }}
            title="Otro color"
          >
            <span className="sr-only">Otro color</span>
            <input
              type="color"
              className="absolute inset-0 cursor-pointer opacity-0"
              value={color ?? COLOR_MARCA}
              onChange={(e) => setColor(esColorHex(e.target.value.toLowerCase()) ? e.target.value.toLowerCase() : null)}
            />
          </label>
        </div>
        {!legible ? (
          <p className="text-sm text-red-700">Ese color es muy claro: el texto blanco no se leería. Elegí uno más oscuro.</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={clasesBoton("primario", "md")}
            onClick={guardar}
            disabled={pendiente || !cambioColor || !legible}
          >
            Guardar color
          </button>
          {cambioColor ? (
            <button type="button" className={clasesBoton("fantasma", "md")} onClick={() => setColor(guardado)} disabled={pendiente}>
              Deshacer
            </button>
          ) : null}
        </div>
      </section>
    </Tarjeta>
  );
}
