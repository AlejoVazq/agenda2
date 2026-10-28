"use client";

import { useFormStatus } from "react-dom";
import type { ComponentProps } from "react";
import { clasesBoton, Aviso } from "@/components/ui";
import type { EstadoAccion } from "@/lib/tipos";

/** Botón de submit que se deshabilita mientras la acción está en curso. */
export function BotonEnviar({
  children,
  pendiente = "Guardando…",
  variante,
  tamano,
  className,
  ...props
}: ComponentProps<"button"> & {
  pendiente?: string;
  variante?: "primario" | "secundario" | "fantasma" | "peligro";
  tamano?: "sm" | "md" | "lg";
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || props.disabled} className={clasesBoton(variante, tamano, className)} {...props}>
      {pending ? (
        <>
          <span className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />
          {pendiente}
        </>
      ) : (
        children
      )}
    </button>
  );
}

/** Mensaje general de resultado de una acción (error u OK). */
export function MensajeAccion({ estado }: { estado: EstadoAccion | undefined }) {
  if (!estado) return null;
  if (estado.error) return <Aviso tipo="error">{estado.error}</Aviso>;
  if (estado.ok && estado.mensaje) return <Aviso tipo="exito">{estado.mensaje}</Aviso>;
  return null;
}
