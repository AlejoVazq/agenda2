// Isotipo de Agenda2: una A con el 2 entrelazado (la base del 2 es la barra de la A).
// Mismo dibujo que `src/app/icon.svg` y el componente `Isotipo` de `src/components/ui.tsx`.
export const ISOTIPO_A = "M11 54 32 10l21 44";
export const ISOTIPO_DOS = "M24.8 23.5c0-4.6 3.2-7.6 7.4-7.6s7.4 3 7.4 7.1c0 3.4-1.9 5.6-4.9 8.3L18.5 45.5h28";

/** El isotipo como data URI, para las imágenes generadas con `next/og`. */
export const ISOTIPO_DATA_URI = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">\n  <rect width="64" height="64" rx="16" fill="#1f4d3a"/>\n  <g fill="none" stroke-linecap="round" stroke-linejoin="round">\n    <path d="M11 54 32 10l21 44" stroke="#f3eee4" stroke-width="7"/>\n    <path d="M24.8 23.5c0-4.6 3.2-7.6 7.4-7.6s7.4 3 7.4 7.1c0 3.4-1.9 5.6-4.9 8.3L18.5 45.5h28" stroke="#1f4d3a" stroke-width="10"/>\n    <path d="M24.8 23.5c0-4.6 3.2-7.6 7.4-7.6s7.4 3 7.4 7.1c0 3.4-1.9 5.6-4.9 8.3L18.5 45.5h28" stroke="#e2622b" stroke-width="5.5"/>\n  </g>\n</svg>').toString("base64")}`;
