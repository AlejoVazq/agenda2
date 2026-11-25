import { fotoProductoPorSlug } from "@/lib/productos";

// Foto de un producto de la tienda (activo, de un negocio activo). La URL lleva ?v=<versión>,
// así que se cachea para siempre.
export async function GET(request: Request, { params }: RouteContext<"/n/[slug]/productos/[id]/foto">) {
  const { slug, id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("No encontrado", { status: 404 });
  const foto = await fotoProductoPorSlug(slug, id).catch(() => null);
  if (!foto) return new Response("No encontrado", { status: 404 });

  const conVersion = new URL(request.url).searchParams.has("v");
  return new Response(new Uint8Array(foto.datos), {
    headers: {
      "Content-Type": foto.tipo,
      "Cache-Control": conVersion ? "public, max-age=31536000, immutable" : "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
