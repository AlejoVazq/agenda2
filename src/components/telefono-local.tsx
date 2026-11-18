"use client";

import type { ComponentProps } from "react";
import { Input } from "@/components/ui";
import { CARACTERISTICA, DIGITOS_NUMERO, numeroSinCaracteristica } from "@/lib/telefono-local";

/** Teléfono de la ciudad: la característica fija y solo los dígitos que faltan. */
export function InputTelefonoLocal({
  defaultValue,
  ...props
}: Omit<ComponentProps<"input">, "defaultValue" | "type" | "inputMode" | "maxLength"> & { defaultValue?: string | null }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center font-medium text-zinc-500">
        {CARACTERISTICA}
      </span>
      <Input
        {...props}
        type="tel"
        inputMode="numeric"
        autoComplete="off"
        maxLength={DIGITOS_NUMERO}
        pattern={`[0-9]{${DIGITOS_NUMERO}}`}
        placeholder={"4".padEnd(DIGITOS_NUMERO, "5")}
        defaultValue={numeroSinCaracteristica(defaultValue)}
        onInput={(e) => {
          const campo = e.currentTarget;
          campo.value = campo.value.replace(/\D/g, "").slice(0, DIGITOS_NUMERO);
        }}
        style={{ paddingLeft: "3.75rem" }}
      />
    </div>
  );
}
