import { ImageResponse } from "next/og";
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
            "radial-gradient(ellipse 70% 90% at 100% 0%, rgba(106,67,246,0.75), transparent), radial-gradient(ellipse 60% 80% at 0% 100%, rgba(255,106,61,0.4), transparent), #15111d",
          color: "white",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", fontSize: 40, fontWeight: 800 }}>
          <div
            style={{
              display: "flex",
              width: 64,
              height: 64,
              borderRadius: 18,
              background: "linear-gradient(135deg, #7d5fff, #3b2290)",
              alignItems: "center",
              justifyContent: "center",
              marginRight: 18,
            }}
          >
            2
          </div>
          {MARCA.nombre}
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 92, fontWeight: 800, lineHeight: 1.02, letterSpacing: -3 }}>Tus clientes reservan solos.</div>
          <div style={{ display: "flex", fontSize: 92, fontWeight: 800, lineHeight: 1.02, letterSpacing: -3, color: "#ffab8a" }}>
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
