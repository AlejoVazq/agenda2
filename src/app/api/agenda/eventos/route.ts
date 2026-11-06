import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { sesionParaAccion } from "@/lib/auth";
import { eventosEnRango } from "@/lib/datos-panel";

const esquemaRango = z.object({
  desde: z.iso.datetime({ offset: true }),
  hasta: z.iso.datetime({ offset: true }),
  profesional_id: z.uuid().nullable(),
});

// Eventos del calendario de la agenda. Es una ruta y no una Server Action porque
// las acciones van en cola: una lectura haría esperar a mover o confirmar un turno.
export async function GET(request: NextRequest) {
  const sesion = await sesionParaAccion();
  if (!sesion) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });

  const { searchParams } = request.nextUrl;
  const datos = esquemaRango.safeParse({
    desde: searchParams.get("desde"),
    hasta: searchParams.get("hasta"),
    profesional_id: searchParams.get("profesional_id"),
  });
  if (!datos.success) return NextResponse.json({ error: "Rango inválido" }, { status: 400 });
  const { desde, hasta, profesional_id } = datos.data;

  // Máximo ~6 semanas por consulta.
  if (new Date(hasta).getTime() - new Date(desde).getTime() > 45 * 86_400_000) {
    return NextResponse.json({ error: "Rango demasiado largo" }, { status: 400 });
  }

  return NextResponse.json(await eventosEnRango(desde, hasta, profesional_id));
}
