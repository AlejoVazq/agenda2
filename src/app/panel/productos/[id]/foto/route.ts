import { getSesionPanel } from "@/lib/auth";
import { fotoProductoDe } from "@/lib/productos";

// Foto de un producto para el panel (también de los inactivos, que la ruta pública no sirve).
export async function GET(request: Request, { params }: RouteContext<"/panel/productos/[id]/foto">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("No encontrado", { status: 404 });
  const sesion = await getSesionPanel();
  if (!sesion?.esDueno) return new Response("No autorizado", { status: 401 });

  const foto = await fotoProductoDe(id, sesion.negocio.id).catch(() => null);
  if (!foto) return new Response("No encontrado", { status: 404 });

  const conVersion = new URL(request.url).searchParams.has("v");
  return new Response(new Uint8Array(foto.datos), {
    headers: {
      "Content-Type": foto.tipo,
      "Cache-Control": conVersion ? "private, max-age=31536000, immutable" : "private, no-cache",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
