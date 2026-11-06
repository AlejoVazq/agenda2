// Utilidades de WhatsApp que sirven tanto en el servidor como en el navegador.

/**
 * Deja un teléfono en el formato en que se guarda: en Argentina, característica
 * + número (10 dígitos, sin 54, 9, 0 ni 15). Números de otros países (que ya traen
 * su código) se dejan como están. Misma regla que normalizar_telefono en la base.
 */
export function normalizarTelefono(telefono: string) {
  let n = telefono.replace(/\D/g, "");
  if (n.startsWith("00")) n = n.slice(2);
  if (n.startsWith("549") && n.length === 13) return n.slice(3);
  if (n.startsWith("54") && n.length === 12) return n.slice(2);
  if (n.startsWith("54") && n.length > 12) n = n.slice(2).replace(/^9/, "");
  if (n.startsWith("0")) n = n.slice(1);
  // Característica de 2 a 4 dígitos seguida de "15" (forma local de los celulares).
  if (n.length === 12) {
    for (const largo of [2, 3, 4]) {
      if (n.slice(largo, largo + 2) === "15") {
        n = n.slice(0, largo) + n.slice(largo + 2);
        break;
      }
    }
  }
  return n;
}

/** Formato internacional que usa WhatsApp para Argentina (549 + 10 dígitos). */
export function telefonoWhatsApp(telefono: string) {
  const n = normalizarTelefono(telefono);
  return n.length === 10 ? `549${n}` : n;
}

/** Link de WhatsApp (click to chat) con un mensaje opcional precargado. */
export function linkWhatsApp(telefono: string, texto?: string) {
  return `https://wa.me/${telefonoWhatsApp(telefono)}${texto ? `?text=${encodeURIComponent(texto)}` : ""}`;
}

export const linkWhatsAppCliente = linkWhatsApp;
