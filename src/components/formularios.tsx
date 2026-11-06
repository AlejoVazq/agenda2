"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { ComponentProps } from "react";
import { clasesBoton, Aviso } from "@/components/ui";
import type { EstadoAccion } from "@/lib/tipos";

type EstadoConValores = EstadoAccion & { valores?: Record<string, string>; intento?: number };

/**
 * useActionState + conservar lo que el usuario escribió si la acción falla.
 * React 19 resetea el formulario después de cada envío; con esto los campos
 * vuelven a mostrar lo enviado (usar `valor(nombre, original)` como defaultValue
 * y `key={intento}` en el <form> para que se apliquen).
 */
export function useFormulario<E extends EstadoAccion>(accion: (prev: E, formData: FormData) => Promise<E>) {
  type Estado = E & EstadoConValores;
  const [estado, despachar] = useActionState<Estado, FormData>(
    async (prev: Awaited<Estado>, formData: FormData) => {
      const resultado = await accion(prev, formData);
      const intento = (prev.intento ?? 0) + 1;
      if (resultado.ok) return { ...resultado, intento } as Estado;
      const valores: Record<string, string> = {};
      for (const [k, v] of formData.entries()) {
        if (typeof v === "string" && !/password|^confirmacion$/i.test(k) && !(k in valores)) valores[k] = v;
      }
      return { ...resultado, valores, intento } as Estado;
    },
    {} as Awaited<Estado>,
  );

  /** defaultValue: lo enviado (si falló) o el valor original. */
  function valor(nombre: string, original?: string | number | null) {
    return estado.valores ? (estado.valores[nombre] ?? "") : (original ?? "");
  }
  /** defaultChecked para casillas. */
  function marcado(nombre: string, original: boolean) {
    return estado.valores ? nombre in estado.valores : original;
  }

  return { estado, accion: despachar, valor, marcado, intento: estado.intento ?? 0 };
}

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
