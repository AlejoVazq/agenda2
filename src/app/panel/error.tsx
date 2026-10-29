"use client";

import { useEffect } from "react";
import { Boton, BotonLink } from "@/components/ui";

export default function ErrorPanel({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-xl font-bold">Algo salió mal</h1>
      <p className="mt-2 text-sm text-zinc-600">
        No pudimos cargar esta sección. Puede ser un problema de conexión; probá de nuevo en unos segundos.
      </p>
      {error.digest ? <p className="mt-2 text-xs text-zinc-400">Código: {error.digest}</p> : null}
      <div className="mt-6 flex justify-center gap-2">
        <Boton onClick={reset}>Reintentar</Boton>
        <BotonLink href="/panel" variante="secundario">
          Ir al inicio
        </BotonLink>
      </div>
    </div>
  );
}
