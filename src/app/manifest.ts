import type { MetadataRoute } from "next";
import { MARCA } from "@/lib/marca";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${MARCA.nombre} · Panel`,
    short_name: MARCA.nombre,
    description: MARCA.descripcion,
    start_url: "/panel",
    display: "standalone",
    background_color: "#faf9fc",
    theme_color: "#6322d6",
    lang: "es-AR",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
