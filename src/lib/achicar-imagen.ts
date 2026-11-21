// Achica una imagen en el navegador antes de subirla (logo, foto de profesional).

const LADO_MAX = 512;
const BYTES_MAX = 512 * 1024;

/**
 * Máx. 512 px de lado. Por defecto PNG, que conserva la transparencia y lo entienden
 * también las vistas previas para compartir; si queda muy pesado (fotos), o con
 * `foto`, va como JPG.
 */
export async function achicarImagen(archivo: File, { foto = false }: { foto?: boolean } = {}): Promise<Blob> {
  const bitmap = await createImageBitmap(archivo);
  const escala = Math.min(1, LADO_MAX / Math.max(bitmap.width, bitmap.height));
  const lienzo = document.createElement("canvas");
  lienzo.width = Math.max(1, Math.round(bitmap.width * escala));
  lienzo.height = Math.max(1, Math.round(bitmap.height * escala));
  const ctx = lienzo.getContext("2d");
  if (!ctx) throw new Error("sin canvas");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, lienzo.width, lienzo.height);
  bitmap.close();

  const exportar = (tipo: string, calidad?: number) =>
    new Promise<Blob>((ok, mal) => lienzo.toBlob((b) => (b ? ok(b) : mal(new Error("toBlob"))), tipo, calidad));
  if (!foto) {
    const png = await exportar("image/png");
    if (png.size <= BYTES_MAX) return png;
  }
  // JPG no tiene transparencia: fondo blanco.
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, lienzo.width, lienzo.height);
  return exportar("image/jpeg", 0.88);
}
