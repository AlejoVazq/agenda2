/** Link de WhatsApp a un teléfono argentino (agrega 549 si falta el código de país). */
export function linkWhatsApp(telefono: string, texto?: string) {
  let n = telefono.replace(/\D/g, "");
  if (n.startsWith("0")) n = n.slice(1);
  if (!n.startsWith("54")) n = `549${n}`;
  return `https://wa.me/${n}${texto ? `?text=${encodeURIComponent(texto)}` : ""}`;
}

export const linkWhatsAppCliente = linkWhatsApp;
