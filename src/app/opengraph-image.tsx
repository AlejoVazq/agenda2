/* eslint-disable @next/next/no-img-element -- next/og (Satori) solo entiende <img> */
import { ImageResponse } from "next/og";
import { ISOTIPO_DATA_URI } from "@/lib/isotipo";
import { MARCA } from "@/lib/marca";

// Vista previa al compartir agenda2.tech.
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = `${MARCA.nombre}: turnos online para peluquerías, barberías, uñas y estética`;

export default function Imagen() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background:
            "radial-gradient(ellipse 70% 90% at 100% 0%, rgba(79,146,114,0.6), transparent), radial-gradient(ellipse 60% 80% at 0% 100%, rgba(226,98,43,0.38), transparent), #0e1c16",
          color: "white",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", fontSize: 40, fontWeight: 800 }}>
          <img src={ISOTIPO_DATA_URI} width={64} height={64} style={{ marginRight: 18 }} alt="" />
          {MARCA.nombre}
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 92, fontWeight: 800, lineHeight: 1.02, letterSpacing: -3 }}>Tus clientes reservan solos.</div>
          <div style={{ display: "flex", fontSize: 92, fontWeight: 800, lineHeight: 1.02, letterSpacing: -3, color: "#f0a277" }}>
            Vos, a lo tuyo.
          </div>
        </div>
        <div style={{ display: "flex", fontSize: 30, color: "rgba(255,255,255,0.7)" }}>
          Turnos online para peluquerías, barberías, uñas y estética · 7 días gratis
        </div>
      </div>
    ),
    size,
  );
}
