import { getSesionPanel } from "@/lib/auth";
import { fotoDe } from "@/lib/foto-profesional";

// Foto de un profesional, solo para quienes entran al panel de ese negocio.
export async function GET(request: Request, { params }: RouteContext<"/panel/profesionales/[id]/foto">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("No encontrado", { status: 404 });
  const sesion = await getSesionPanel();
  if (!sesion) return new Response("No autorizado", { status: 401 });

  const foto = await fotoDe(id, sesion.negocio.id).catch(() => null);
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
