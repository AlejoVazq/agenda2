import { NextResponse } from "next/server";
import { getSesionPanel } from "@/lib/auth";
import { comoUsuario, sql } from "@/lib/db";
import { estaApagado } from "@/lib/suscripcion";

// Exporta la lista de clientes del negocio en CSV (para Excel / Google Sheets).

function celda(valor: unknown) {
  let texto = valor === null || valor === undefined ? "" : String(valor);
  // Evita que una planilla interprete el contenido como fórmula.
  if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;
  return /[";\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

export async function GET() {
  const sesion = await getSesionPanel();
  if (!sesion?.esDueno || estaApagado(sesion.suscripcion.estado)) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  let data: { nombre: string; telefono: string; email: string | null; notas: string | null; created_at: string; turnos: number; ultimo: string | null }[];
  try {
    data = await comoUsuario(sesion.userId, (tx) =>
      tx.varios(sql`
        select c.nombre, c.telefono, c.email, c.notas, c.created_at,
               count(t.id) as turnos, max(t.inicio) as ultimo
        from public.clientes c
        left join public.turnos t on t.cliente_id = c.id and t.estado not in ('cancelado', 'ausente')
        where c.negocio_id = ${sesion.negocio.id}
        group by c.id
        order by c.nombre
        limit 10000`),
    );
  } catch (e) {
    console.error("[clientes] exportar", e);
    return NextResponse.json({ error: "No se pudo exportar" }, { status: 500 });
  }

  const fecha = (iso: string) =>
    new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeZone: sesion.negocio.zona_horaria }).format(new Date(iso));
  const filas = data.map((c) => [
    c.nombre,
    c.telefono,
    c.email,
    c.notas,
    c.turnos,
    c.ultimo ? fecha(c.ultimo) : "",
    fecha(c.created_at),
  ]);

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
