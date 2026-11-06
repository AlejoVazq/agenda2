import { NextResponse } from "next/server";
import { getSesionPanel } from "@/lib/auth";
import { crearSupabaseServidor } from "@/lib/supabase/server";

// Exporta la lista de clientes del negocio en CSV (para Excel / Google Sheets).

function celda(valor: unknown) {
  let texto = valor === null || valor === undefined ? "" : String(valor);
  // Evita que una planilla interprete el contenido como fórmula.
  if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;
  return /[";\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

export async function GET() {
  const sesion = await getSesionPanel();
  if (!sesion?.esDueno) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const supabase = await crearSupabaseServidor();
  const { data, error } = await supabase
    .from("clientes")
    .select("nombre, telefono, email, notas, created_at, turnos(inicio, estado)")
    .eq("negocio_id", sesion.negocio.id)
    .order("nombre")
    .limit(10000);
  if (error) return NextResponse.json({ error: "No se pudo exportar" }, { status: 500 });

  const fecha = (iso: string) =>
    new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeZone: sesion.negocio.zona_horaria }).format(new Date(iso));
  const filas = (data ?? []).map((c) => {
    const turnos = (c.turnos as { inicio: string; estado: string }[]).filter((t) => t.estado !== "cancelado" && t.estado !== "ausente");
    const ultimo = turnos.map((t) => t.inicio).sort().at(-1);
    return [c.nombre, c.telefono, c.email, c.notas, turnos.length, ultimo ? fecha(ultimo) : "", fecha(c.created_at)];
  });

  // Separador ";" y BOM: así Excel en español lo abre bien.
  const csv =
    "﻿" +
    [["Nombre", "Celular", "Email", "Notas", "Turnos", "Último turno", "Cliente desde"], ...filas]
      .map((fila) => fila.map(celda).join(";"))
      .join("\r\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="clientes-${sesion.negocio.slug}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
