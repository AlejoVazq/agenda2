"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Aviso, Boton } from "@/components/ui";
import type { EstadoAccion } from "@/lib/tipos";

/**
 * Botón que ejecuta una Server Action (sin formulario), con confirmación
 * opcional en dos pasos y mensaje de resultado. Refresca la página al terminar.
 */
export function BotonAccion({
  accion,
  children,
  confirmar,
  variante = "secundario",
  tamano = "sm",
  pendiente = "Un momento…",
  className,
}: {
  accion: () => Promise<EstadoAccion>;
  children: ReactNode;
  /** Texto del botón de confirmación; si se omite, ejecuta directo. */
  confirmar?: string;
  variante?: "primario" | "secundario" | "fantasma" | "peligro" | "oscuro" | "coral";
  tamano?: "sm" | "md" | "lg";
  pendiente?: string;
  className?: string;
}) {
  const router = useRouter();
  const [resultado, setResultado] = useState<EstadoAccion>();
  const [confirmando, setConfirmando] = useState(false);
  const [enCurso, iniciar] = useTransition();

  function ejecutar() {
    iniciar(async () => {
      const r = await accion();
      setResultado(r);
      setConfirmando(false);
      router.refresh();
    });
  }

  return (
    <div className={className}>
      {confirmando ? (
        <div className="flex flex-wrap gap-2">
          <Boton variante={variante === "peligro" ? "peligro" : "primario"} tamano={tamano} disabled={enCurso} onClick={ejecutar}>
            {enCurso ? pendiente : confirmar}
          </Boton>
          <Boton variante="fantasma" tamano={tamano} disabled={enCurso} onClick={() => setConfirmando(false)}>
            No
          </Boton>
        </div>
      ) : (
        <Boton variante={variante} tamano={tamano} disabled={enCurso} onClick={() => (confirmar ? setConfirmando(true) : ejecutar())}>
          {enCurso ? pendiente : children}
        </Boton>
      )}
      {resultado?.error ? (
        <Aviso tipo="error" className="mt-2">
          {resultado.error}
        </Aviso>
      ) : resultado?.ok && resultado.mensaje ? (
        <p className="mt-2 text-sm font-medium text-emerald-700" role="status">
          {resultado.mensaje}
        </p>
      ) : null}
    </div>
  );
}
