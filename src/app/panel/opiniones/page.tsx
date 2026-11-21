import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { cx, EncabezadoPagina, Tarjeta, Vacio } from "@/components/ui";
import { ResumenOpiniones } from "@/components/opiniones";
import { requerirDueno } from "@/lib/auth";
import { comoUsuario, sql } from "@/lib/db";
import type { ResumenResenas } from "@/lib/resenas";
import { InterruptorOpiniones, OpinionPanel } from "./formularios";

export const metadata: Metadata = { title: "Opiniones" };

const POR_PAGINA = 30;

export type OpinionDelPanel = {
  id: string;
  autor: string;
  estrellas: number;
  comentario: string | null;
  comentario_oculto: boolean;
  respuesta: string | null;
  profesional: string | null;
  servicio: string | null;
  cliente_id: string | null;
  /** Null si se dejó desde la página, sin turno. */
  turno_inicio: string | null;
  created_at: string;
};

export default async function PaginaOpiniones({ searchParams }: PageProps<"/panel/opiniones">) {
  const { negocio, userId } = await requerirDueno();
  const sp = await searchParams;
  const profesional = z.uuid().safeParse(sp.profesional).success ? (sp.profesional as string) : null;
  const pedida = Number(sp.pagina);
  const pagina = Number.isInteger(pedida) && pedida > 1 ? pedida : 1;

  const { activas, profesionales, conteo, lista } = await comoUsuario(userId, async (tx) => {
    const n = await tx.uno<{ resenas_activas: boolean }>(sql`select resenas_activas from public.negocios where id = ${negocio.id}`);
    const profesionales = await tx.varios<{ id: string; nombre: string; cantidad: number; promedio: number | null }>(sql`
      select p.id, p.nombre, count(r.id)::int as cantidad, round(avg(r.estrellas), 1)::float as promedio
      from public.profesionales p
      left join public.resenas r on r.profesional_id = p.id
      where p.negocio_id = ${negocio.id}
      group by p.id, p.nombre, p.orden
      having count(r.id) > 0 or bool_or(p.activo)
      order by p.orden, p.nombre`);
    const conteo = await tx.varios<{ estrellas: number; n: number }>(sql`
      select estrellas, count(*)::int as n from public.resenas
      where negocio_id = ${negocio.id} and (${profesional}::uuid is null or profesional_id = ${profesional}::uuid)
      group by estrellas`);
    const lista = await tx.varios<OpinionDelPanel>(sql`
      select r.id, r.autor, r.estrellas, r.comentario, r.comentario_oculto, r.respuesta,
             p.nombre as profesional, s.nombre as servicio, t.cliente_id, t.inicio as turno_inicio, r.created_at
      from public.resenas r
      left join public.profesionales p on p.id = r.profesional_id
      left join public.servicios s on s.id = r.servicio_id
      left join public.turnos t on t.id = r.turno_id
      where r.negocio_id = ${negocio.id} and (${profesional}::uuid is null or r.profesional_id = ${profesional}::uuid)
      order by r.created_at desc, r.id
      limit ${POR_PAGINA} offset ${(pagina - 1) * POR_PAGINA}`);
    return { activas: n?.resenas_activas ?? true, profesionales, conteo, lista };
  });

  const porEstrellas = [1, 2, 3, 4, 5].map((e) => conteo.find((c) => c.estrellas === e)?.n ?? 0) as ResumenResenas["porEstrellas"];
  const cantidad = porEstrellas.reduce((s, n) => s + n, 0);
  const suma = porEstrellas.reduce((s, n, i) => s + n * (i + 1), 0);
  const resumen: ResumenResenas = {
    activas,
    promedio: cantidad ? Math.round((suma / cantidad) * 10) / 10 : null,
    cantidad,
    porEstrellas,
    porProfesional: {},
  };
  const paginas = Math.max(1, Math.ceil(cantidad / POR_PAGINA));
  const enlace = (o: { profesional?: string | null; pagina?: number }) => {
    const p = new URLSearchParams();
    const prof = o.profesional === undefined ? profesional : o.profesional;
    if (prof) p.set("profesional", prof);
    if (o.pagina && o.pagina > 1) p.set("pagina", String(o.pagina));
    const q = p.toString();
    return q ? `/panel/opiniones?${q}` : "/panel/opiniones";
  };

  return (
    <div className="space-y-6">
      <EncabezadoPagina
        titulo="Opiniones"
        descripcion="Lo que dicen tus clientes. Opina quien tuvo un turno (desde el link de su reserva) y cualquiera desde tu página. Si alguna es basura, eliminala."
      />

      <Tarjeta className="space-y-4">
        <InterruptorOpiniones activas={activas} slug={negocio.slug} />
      </Tarjeta>

      {profesionales.length > 1 ? (
        <nav className="flex flex-wrap gap-2" aria-label="Filtrar por profesional">
          {[{ id: null as string | null, nombre: "Todos", cantidad: 0, promedio: null as number | null }, ...profesionales].map((p) => (
            <Link
              key={p.id ?? "todos"}
              href={enlace({ profesional: p.id, pagina: 1 })}
              className={cx(
                "rounded-full px-3.5 py-1.5 text-sm font-semibold ring-1 transition",
                profesional === p.id ? "bg-marca-700 text-white ring-marca-700" : "bg-white text-zinc-700 ring-zinc-200 hover:ring-marca-300",
              )}
            >
              {p.nombre}
              {p.id && p.promedio !== null ? (
                <span className={cx("ml-1.5 font-normal", profesional === p.id ? "text-white/80" : "text-zinc-500")}>
                  ★ {p.promedio.toFixed(1).replace(".", ",")} ({p.cantidad})
                </span>
              ) : null}
            </Link>
          ))}
        </nav>
      ) : null}

      {cantidad === 0 ? (
        <Vacio
          titulo={profesional ? "Sin opiniones para este profesional" : "Todavía no hay opiniones"}
          descripcion="Unas horas después de cada turno le mandamos un mail al cliente para que cuente cómo le fue. También pueden opinar desde tu página."
        />
      ) : (
        <>
          <Tarjeta>
            <ResumenOpiniones resumen={resumen} />
          </Tarjeta>
          <ul className="space-y-3">
            {lista.map((o) => (
              <li key={o.id}>
                <OpinionPanel opinion={o} zona={negocio.zona_horaria} />
              </li>
            ))}
          </ul>
          {paginas > 1 ? (
            <nav className="flex items-center justify-between text-sm" aria-label="Páginas">
              {pagina > 1 ? (
                <Link href={enlace({ pagina: pagina - 1 })} className="rounded-xl px-3 py-2 font-semibold text-marca-800 hover:bg-white">
                  ← Más nuevas
                </Link>
              ) : (
                <span />
              )}
              <span className="text-zinc-500">
                Página {pagina} de {paginas}
              </span>
              {pagina < paginas ? (
                <Link href={enlace({ pagina: pagina + 1 })} className="rounded-xl px-3 py-2 font-semibold text-marca-800 hover:bg-white">
                  Más viejas →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}
