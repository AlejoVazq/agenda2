// Color de la página de reservas de cada negocio (negocios.color, migración 0011).
// Se usa en el servidor y en el navegador: sin "server-only".

/** Colores sugeridos. null = el verde pino de la marca. */
export const COLORES_SUGERIDOS: { nombre: string; color: string | null }[] = [
  { nombre: "Verde pino", color: null },
  { nombre: "Carbón", color: "#1c1917" },
  { nombre: "Azul", color: "#1e3a8a" },
  { nombre: "Petróleo", color: "#0f766e" },
  { nombre: "Violeta", color: "#5b21b6" },
  { nombre: "Frambuesa", color: "#9d174d" },
  { nombre: "Bordó", color: "#7f1d1d" },
  { nombre: "Ladrillo", color: "#9a3412" },
  { nombre: "Marrón", color: "#78350f" },
];

/** El verde de la marca (--color-marca-700), para mostrarlo en el panel. */
export const COLOR_MARCA = "#1f4d3a";

export const esColorHex = (v: string) => /^#[0-9a-f]{6}$/.test(v);

/** Contraste WCAG del color contra el blanco (1 a 21). */
export function contrasteConBlanco(hex: string): number {
  const canal = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5);
  return 1.05 / (l + 0.05);
}

/** La página lleva texto blanco sobre el color: tiene que leerse bien (AA, 4.5:1). */
export const CONTRASTE_MINIMO = 4.5;
export const colorLegible = (hex: string) => esColorHex(hex) && contrasteConBlanco(hex) >= CONTRASTE_MINIMO;

/**
 * Variables CSS para la clase `tema-negocio` (globals.css), que arma con este color toda la
 * escala marca-* dentro de la página. Sin color, nada: queda el verde de la marca.
 */
export function estiloTema(color: string | null | undefined): React.CSSProperties | undefined {
  return color && esColorHex(color) ? ({ "--tema": color } as React.CSSProperties) : undefined;
}
