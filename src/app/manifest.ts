import type { MetadataRoute } from "next";
import { MARCA } from "@/lib/marca";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${MARCA.nombre} · Panel`,
    short_name: MARCA.nombre,
    description: MARCA.descripcion,
    start_url: "/panel",
    display: "standalone",
    background_color: "#f3eee4",
    theme_color: "#1f4d3a",
    lang: "es-AR",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
