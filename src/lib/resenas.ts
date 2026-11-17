import "server-only";
import { cache } from "react";
import { comoServidor, sql } from "@/lib/db";

// Reseñas (migración 0012). El portal es anónimo y el anónimo no lee tablas: se leen con
// el rol del servidor, y acá se decide qué se muestra (nunca un comentario oculto).

export type PromedioResenas = { promedio: number; cantidad: number };

export type ResumenResenas = {
  activas: boolean;
  promedio: number | null;
  cantidad: number;
  /** Cantidad con 1, 2, 3, 4 y 5 estrellas (índice 0 = 1 estrella). */
  porEstrellas: [number, number, number, number, number];
  porProfesional: Record<string, PromedioResenas>;
};

export type ResenaPublica = {
  id: string;
  autor: string;
  estrellas: number;
  comentario: string | null;
  respuesta: string | null;
  profesional: string;
  servicio: string;
  created_at: string;
};

const VACIO: ResumenResenas = { activas: false, promedio: null, cantidad: 0, porEstrellas: [0, 0, 0, 0, 0], porProfesional: {} };

export const resumenResenas = cache(async (negocioId: string): Promise<ResumenResenas> => {
  try {
    const fila = await comoServidor((tx) =>
      tx.uno<{ activas: boolean; estrellas: number[] | null; profesionales: Record<string, PromedioResenas> | null }>(sql`
        select n.resenas_activas as activas,
          (select array_agg((select count(*) from public.resenas r where r.negocio_id = n.id and r.estrellas = e)::int order by e)
             from generate_series(1, 5) e) as estrellas,
          (select jsonb_object_agg(profesional_id, jsonb_build_object('promedio', round(prom, 1), 'cantidad', cant))
             from (select profesional_id, avg(estrellas) as prom, count(*)::int as cant
                   from public.resenas where negocio_id = n.id group by profesional_id) x) as profesionales
        from public.negocios n where n.id = ${negocioId}`),
    );
    if (!fila || !fila.activas) return VACIO;
    const porEstrellas = (fila.estrellas ?? [0, 0, 0, 0, 0]).map(Number) as ResumenResenas["porEstrellas"];
    const cantidad = porEstrellas.reduce((s, n) => s + n, 0);
    const suma = porEstrellas.reduce((s, n, i) => s + n * (i + 1), 0);
    return {
      activas: true,
      promedio: cantidad ? Math.round((suma / cantidad) * 10) / 10 : null,
      cantidad,
      porEstrellas,
      porProfesional: fila.profesionales ?? {},
    };
  } catch (e) {
    console.error("[resenas] resumen", e);
    return VACIO;
  }
});

/** Las más nuevas primero. `soloConComentario` saltea las que no tienen texto visible. */
export async function resenasPublicas(
  negocioId: string,
  o: { limite: number; desplazamiento?: number; soloConComentario?: boolean },
): Promise<ResenaPublica[]> {
  const soloTexto = o.soloConComentario ?? false;
  try {
    return await comoServidor((tx) =>
      tx.varios<ResenaPublica>(sql`
        select r.id, r.autor, r.estrellas,
               case when r.comentario_oculto then null else r.comentario end as comentario,
               r.respuesta, p.nombre as profesional, s.nombre as servicio, r.created_at
        from public.resenas r
        join public.negocios n on n.id = r.negocio_id and n.resenas_activas
        join public.profesionales p on p.id = r.profesional_id
        join public.servicios s on s.id = r.servicio_id
        where r.negocio_id = ${negocioId}
          and (not ${soloTexto}::boolean or (r.comentario is not null and not r.comentario_oculto))
        order by r.created_at desc, r.id
        limit ${Math.min(Math.max(o.limite, 1), 50)} offset ${Math.max(o.desplazamiento ?? 0, 0)}`),
    );
  } catch (e) {
    console.error("[resenas] lista", e);
    return [];
  }
}

export type ResenaDeTurno = {
  /** El turno ya pasó (hasta 60 días) y el negocio recibe opiniones. */
  puede: boolean;
  resena: { estrellas: number; comentario: string | null; oculto: boolean; respuesta: string | null } | null;
};

/** Las mismas reglas que public.dejar_resena, para mostrar o no el formulario. */
export async function resenaDeTurno(token: string): Promise<ResenaDeTurno> {
  if (!/^[0-9a-f]{64}$/.test(token)) return { puede: false, resena: null };
  try {
    const fila = await comoServidor((tx) =>
      tx.uno<{ puede: boolean; estrellas: number | null; comentario: string | null; oculto: boolean | null; respuesta: string | null }>(sql`
        select n.resenas_activas and t.estado in ('confirmado', 'completado')
                 and t.fin <= now() and t.fin > now() - interval '60 days' as puede,
               r.estrellas, r.comentario, r.comentario_oculto as oculto, r.respuesta
        from public.turnos t
        join public.negocios n on n.id = t.negocio_id
        left join public.resenas r on r.turno_id = t.id
        where t.token_cancelacion = ${token}`),
    );
    if (!fila) return { puede: false, resena: null };
    return {
      puede: fila.puede,
      resena:
        fila.estrellas === null
          ? null
          : { estrellas: fila.estrellas, comentario: fila.comentario, oculto: Boolean(fila.oculto), respuesta: fila.respuesta },
    };
  } catch (e) {
    console.error("[resenas] de turno", e);
    return { puede: false, resena: null };
  }
}
