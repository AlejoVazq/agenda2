import { logoPorSlug } from "@/lib/logo";

// Logo del negocio para la página de reservas. La URL lleva ?v=<versión>, así que se cachea para siempre.
export async function GET(request: Request, { params }: RouteContext<"/n/[slug]/logo">) {
  const { slug } = await params;
  const logo = await logoPorSlug(slug).catch(() => null);
  if (!logo) return new Response("No encontrado", { status: 404 });

  const conVersion = new URL(request.url).searchParams.has("v");
  return new Response(new Uint8Array(logo.datos), {
    headers: {
      "Content-Type": logo.tipo,
      "Cache-Control": conVersion ? "public, max-age=31536000, immutable" : "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
