// Utilidades de WhatsApp que sirven tanto en el servidor como en el navegador.

/**
 * Normaliza un teléfono al formato internacional que usa WhatsApp para
 * Argentina (549 + característica + número, sin 0 ni 15). Números de otros
 * países (que ya traen su código) se dejan como están.
 */
export function telefonoWhatsApp(telefono: string) {
  let n = telefono.replace(/\D/g, "");
  if (n.startsWith("00")) n = n.slice(2);
  if (n.startsWith("549") && n.length === 13) return n;
  if (n.startsWith("54") && n.length === 12) return `549${n.slice(2)}`;
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
  if (n.length === 10) return `549${n}`;
  return n;
}

/** Link de WhatsApp (click to chat) con un mensaje opcional precargado. */
export function linkWhatsApp(telefono: string, texto?: string) {
  return `https://wa.me/${telefonoWhatsApp(telefono)}${texto ? `?text=${encodeURIComponent(texto)}` : ""}`;
}

export const linkWhatsAppCliente = linkWhatsApp;
