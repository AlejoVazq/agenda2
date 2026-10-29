import { ImageResponse } from "next/og";
import { MARCA } from "@/lib/marca";
import { getNegocioPublico } from "@/lib/publico";
import { RUBROS, type Rubro } from "@/lib/tipos";

// Vista previa al compartir el link de reservas (WhatsApp, Instagram, etc.).
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Reservá tu turno online";

export default async function Imagen({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const negocio = await getNegocioPublico(slug);
  const nombre = negocio?.nombre ?? MARCA.nombre;
  const rubro = negocio ? (RUBROS[negocio.rubro as Rubro] ?? "Turnos online") : "Turnos online";

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
          background: "linear-gradient(135deg, #3b0f8c 0%, #6322d6 55%, #8b5cf6 100%)",
          color: "white",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 30, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", opacity: 0.8 }}>
          {rubro}
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: nombre.length > 24 ? 76 : 96, fontWeight: 800, lineHeight: 1.05 }}>{nombre}</div>
          <div style={{ display: "flex", marginTop: 24, fontSize: 40, opacity: 0.9 }}>Reservá tu turno online, en un minuto.</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", fontSize: 30, opacity: 0.85 }}>
          <div
            style={{
              display: "flex",
              width: 48,
              height: 48,
              borderRadius: 14,
              background: "white",
              color: "#6322d6",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 800,
              marginRight: 16,
            }}
          >
            ✓
          </div>
          {MARCA.nombre}
        </div>
      </div>
    ),
    size,
  );
}
