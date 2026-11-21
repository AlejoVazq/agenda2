"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "@/components/ui";

/** Lo que dura la salida (más corta que la entrada: irse no hace esperar). */
const SALIDA_MS = 200;

/**
 * Diálogo simple: hoja inferior en móvil, ventana centrada en escritorio. Entra con
 * movimiento (la hoja sube, la ventana crece) y sale con la misma animación al revés.
 */
export function Modal({
  abierto,
  onCerrar,
  titulo,
  children,
}: {
  abierto: boolean;
  onCerrar: () => void;
  titulo: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!abierto) return;
    const alPresionar = (e: KeyboardEvent) => e.key === "Escape" && onCerrar();
    document.addEventListener("keydown", alPresionar);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", alPresionar);
      document.body.style.overflow = overflow;
    };
  }, [abierto, onCerrar]);

  // Al cerrarse queda montado un momento para animar la salida.
  const [montado, setMontado] = useState(abierto);
  if (abierto && !montado) setMontado(true);
  useEffect(() => {
    if (abierto || !montado) return;
    const t = setTimeout(() => setMontado(false), SALIDA_MS);
    return () => clearTimeout(t);
  }, [abierto, montado]);

  // Mientras sale, se sigue viendo lo último que mostraba (el padre ya lo puso en null).
  const ultimo = useRef({ titulo, children });
  useEffect(() => {
    if (abierto) ultimo.current = { titulo, children };
  });

  if (!montado) return null;
  const saliendo = !abierto;
  // eslint-disable-next-line react-hooks/refs -- solo se lee durante la salida, cuando ya no cambia
  const contenido = saliendo ? ultimo.current : { titulo, children };

  return (
    <div
      className={cx("fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4", saliendo && "pointer-events-none")}
      role="dialog"
      aria-modal="true"
    >
      <button
        aria-label="Cerrar"
        className={cx("absolute inset-0 bg-tinta/40 backdrop-blur-[2px]", saliendo ? "animate-fundido-salida" : "animate-fundido")}
        onClick={onCerrar}
      />
      <div
        className={cx(
          "relative max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:max-w-lg sm:rounded-3xl sm:p-6",
          saliendo ? "animate-hoja-salida sm:animate-ventana-salida" : "animate-hoja sm:animate-ventana",
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-lg font-bold">{contenido.titulo}</h2>
          <button
            onClick={onCerrar}
            className="-m-1 grid size-9 shrink-0 place-items-center rounded-full text-zinc-500 hover:bg-zinc-100"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>
        {contenido.children}
      </div>
    </div>
  );
}
