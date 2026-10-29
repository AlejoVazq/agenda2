"use client";

import { useEffect } from "react";
import { Boton, BotonLink, Logo } from "@/components/ui";

export default function ErrorGeneral({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <Logo />
      <h1 className="mt-8 text-2xl font-bold">Algo salió mal</h1>
      <p className="mt-2 max-w-sm text-sm text-zinc-600">Tuvimos un problema para mostrar esta página. Probá de nuevo en un momento.</p>
      <div className="mt-6 flex gap-2">
        <Boton onClick={reset}>Reintentar</Boton>
        <BotonLink href="/" variante="secundario">
          Ir al inicio
        </BotonLink>
      </div>
    </main>
  );
}
