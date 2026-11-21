"use client";

import { useState } from "react";
import { cx } from "@/components/ui";

const ETIQUETAS = ["", "Malo", "Regular", "Bueno", "Muy bueno", "¡Excelente!"];

/** Cinco estrellas para elegir el puntaje (radios `estrellas` de 1 a 5). */
export function SelectorEstrellas({ inicial = 0, error }: { inicial?: number; error?: boolean }) {
  const [estrellas, setEstrellas] = useState(inicial);
  const [encima, setEncima] = useState(0);
  const mostrada = encima || estrellas;
  return (
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
            <svg
              viewBox="0 0 24 24"
              // La estrella elegida "salta" (key nueva = la animación vuelve a correr).
              key={n === estrellas ? `elegida-${estrellas}` : n}
              className={cx(
                "size-10 transition-colors",
                n <= mostrada ? "text-amber-400" : "text-zinc-200",
                n === estrellas && "animate-pop",
              )}
              aria-hidden
            >
              <path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z" fill="currentColor" />
            </svg>
          </label>
        ))}
        <span className="ml-2 text-sm font-semibold text-zinc-600" aria-live="polite">
          {ETIQUETAS[mostrada]}
        </span>
      </div>
      {error ? <p className="mt-1 text-sm text-red-700">Elegí de 1 a 5 estrellas.</p> : null}
    </fieldset>
  );
}
