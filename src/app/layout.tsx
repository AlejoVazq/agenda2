import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Plus_Jakarta_Sans } from "next/font/google";
import { env } from "@/lib/env";
import { MARCA } from "@/lib/marca";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
});

// Títulos: grotesca con carácter (ver --font-display en globals.css).
const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(env.siteUrl),
  title: { default: `${MARCA.nombre} · ${MARCA.lema}`, template: `%s · ${MARCA.nombre}` },
  description: MARCA.descripcion,
};

export const viewport: Viewport = {
  themeColor: "#f3eee4",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es-AR" className={`${jakarta.variable} ${bricolage.variable} h-full scroll-smooth antialiased`}>
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
