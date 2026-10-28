import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // El panel y el portal dependen de la sesión / disponibilidad en tiempo real,
  // así que usamos renderizado dinámico clásico (sin Cache Components).
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
