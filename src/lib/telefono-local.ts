import { normalizarTelefono } from "@/lib/whatsapp";

/**
 * Por ahora la app es solo para una ciudad: los teléfonos del local y de los servicios
 * de emergencia tienen que ser de esta característica. Para sumar otras ciudades,
 * cambiar esto (y la ayuda de los formularios sale sola).
 */
export const CARACTERISTICA = "2478";

/** Dígitos que van después de la característica (en Argentina son 10 en total). */
export const DIGITOS_NUMERO = 10 - CARACTERISTICA.length;

const COMPLETO = new RegExp(`^${CARACTERISTICA}[0-9]{${DIGITOS_NUMERO}}$`);

/**
 * Teléfono guardado (10 dígitos) a partir de lo que se escribió: solo el número
 * (sin la característica) o el número entero en cualquier formato. Null si está vacío
 * o no es de la característica.
 */
export function telefonoLocal(texto: string): string | null {
  const digitos = texto.replace(/\D/g, "");
  if (digitos === "") return null;
  const completo = digitos.length === DIGITOS_NUMERO ? CARACTERISTICA + digitos : normalizarTelefono(digitos);
  return COMPLETO.test(completo) ? completo : null;
}

/** Lo que se muestra en el campo: el número sin la característica ("" si no es de acá). */
export function numeroSinCaracteristica(telefono: string | null | undefined): string {
  if (!telefono) return "";
  const digitos = telefono.replace(/\D/g, "");
  if (digitos.length === DIGITOS_NUMERO) return digitos;
  const completo = telefonoLocal(digitos);
  return completo ? completo.slice(CARACTERISTICA.length) : "";
}

export const MENSAJE_TELEFONO = `Ingresá los ${DIGITOS_NUMERO} números que van después del ${CARACTERISTICA}`;
