import { portadaPorSlug } from "@/lib/portada";

// Portada de la página de reservas. La URL lleva ?v=<versión>, así que se cachea para siempre.
export async function GET(request: Request, { params }: RouteContext<"/n/[slug]/portada">) {
  const { slug } = await params;
  const portada = await portadaPorSlug(slug).catch(() => null);
  if (!portada) return new Response("No encontrado", { status: 404 });

  const conVersion = new URL(request.url).searchParams.has("v");
  return new Response(new Uint8Array(portada.datos), {
    headers: {
      "Content-Type": portada.tipo,
      "Cache-Control": conVersion ? "public, max-age=31536000, immutable" : "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
