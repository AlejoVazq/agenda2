"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

// Montos que se pueden tapar con un ojito (estadísticas). Arrancan tapados y el
// dispositivo recuerda la elección; si el navegador no deja guardar, siguen tapados.

const CLAVE = "agenda2:plata-visible";
const Contexto = createContext<{ visible: boolean; alternar: () => void }>({ visible: false, alternar: () => {} });

export function ConPlataOculta({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- se lee después de hidratar para no desfasar el HTML
      setVisible(localStorage.getItem(CLAVE) === "1");
    } catch {
      // Sin almacenamiento: queda tapado.
    }
  }, []);
  function alternar() {
    setVisible((v) => {
      try {
        localStorage.setItem(CLAVE, v ? "0" : "1");
      } catch {
        // Sin almacenamiento: vale solo para esta visita.
      }
      return !v;
    });
  }
  return <Contexto.Provider value={{ visible, alternar }}>{children}</Contexto.Provider>;
}

/** Un monto: el texto, o "$ •••••" si está tapado. */
export function Plata({ texto }: { texto: string | null | undefined }) {
  const { visible } = useContext(Contexto);
  if (!texto) return null;
  return visible ? <>{texto}</> : <span aria-label="Monto oculto">$ •••••</span>;
}

/** Botón con un ojo para mostrar u ocultar los montos. */
export function OjitoPlata() {
  const { visible, alternar } = useContext(Contexto);
  return (
    <button
      type="button"
      onClick={alternar}
      aria-pressed={visible}
      className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-sm font-semibold text-zinc-700 transition-colors hover:border-marca-300"
    >
      <svg viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden>
        <path
          d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
        {visible ? null : <path d="M4 4l16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
      </svg>
      {visible ? "Ocultar montos" : "Mostrar montos"}
    </button>
  );
}
