import type { MetadataRoute } from "next";
import { MARCA } from "@/lib/marca";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${MARCA.nombre} · Panel`,
    short_name: MARCA.nombre,
    description: MARCA.descripcion,
    start_url: "/panel",
    display: "standalone",
    background_color: "#fbf9f6",
    theme_color: "#5932e0",
    lang: "es-AR",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
