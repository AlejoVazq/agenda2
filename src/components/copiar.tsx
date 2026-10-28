"use client";

import { useState } from "react";
import { clasesBoton } from "@/components/ui";

export function BotonCopiar({ texto, etiqueta = "Copiar link" }: { texto: string; etiqueta?: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      className={clasesBoton("secundario", "sm")}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(texto);
          setCopiado(true);
          setTimeout(() => setCopiado(false), 2000);
        } catch {
          window.prompt("Copiá el link:", texto);
        }
      }}
    >
      {copiado ? "¡Copiado!" : etiqueta}
    </button>
  );
}
