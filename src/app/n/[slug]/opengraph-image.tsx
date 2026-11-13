/* eslint-disable @next/next/no-img-element -- next/og (Satori) solo entiende <img> */
import { ImageResponse } from "next/og";
import { ISOTIPO_DATA_URI } from "@/lib/isotipo";
import { MARCA } from "@/lib/marca";
import { logoDataUri } from "@/lib/logo";
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
  const inicial = nombre.trim().charAt(0).toUpperCase();
  const logo = negocio ? await logoDataUri(slug) : null;

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
            "radial-gradient(ellipse 70% 90% at 100% 0%, rgba(79,146,114,0.6), transparent), radial-gradient(ellipse 60% 80% at 0% 100%, rgba(130,180,154,0.16), transparent), #0e1c16",
          color: "white",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          {logo ? (
            <img
              src={logo}
              width={112}
              height={112}
              style={{ borderRadius: 28, background: "white", padding: 10, objectFit: "contain", marginRight: 28 }}
              alt=""
            />
          ) : (
          <div
            style={{
              display: "flex",
              width: 96,
              height: 96,
              borderRadius: 28,
              background: "rgba(255,255,255,0.12)",
              border: "2px solid rgba(255,255,255,0.2)",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 48,
              fontWeight: 800,
              marginRight: 28,
            }}
          >
            {inicial}
          </div>
          )}
          <div style={{ display: "flex", fontSize: 28, fontWeight: 700, letterSpacing: 4, textTransform: "uppercase", color: "#f0a277" }}>
            {rubro}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: nombre.length > 24 ? 80 : 104, fontWeight: 800, lineHeight: 1.02, letterSpacing: -3 }}>
            {nombre}
          </div>
          <div style={{ display: "flex", marginTop: 24, fontSize: 40, color: "rgba(255,255,255,0.75)" }}>
            Reservá tu turno online, en un minuto.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", fontSize: 30, color: "rgba(255,255,255,0.7)" }}>
          <img src={ISOTIPO_DATA_URI} width={48} height={48} style={{ marginRight: 16 }} alt="" />
          Turnos con {MARCA.nombre}
        </div>
      </div>
    ),
    size,
  );
}
