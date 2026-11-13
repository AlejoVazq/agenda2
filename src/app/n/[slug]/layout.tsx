import { notFound } from "next/navigation";
import { getNegocioPublico } from "@/lib/publico";

// El chequeo va acá y no solo en la página: `loading.tsx` envuelve a la página, así que
// para cuando ella llama a notFound() la respuesta ya salió con 200. El layout corre
// antes de ese límite, y una dirección que no existe devuelve 404 de verdad.
// getNegocioPublico está cacheada por pedido: la página no repite la consulta.
export default async function LayoutNegocio({ children, params }: LayoutProps<"/n/[slug]">) {
  const { slug } = await params;
  if (!(await getNegocioPublico(slug))) notFound();
  return children;
}
