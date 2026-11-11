import type { Metadata } from "next";
import { Aviso, EncabezadoPagina, Tarjeta, Vacio } from "@/components/ui";
import { requerirPanel } from "@/lib/auth";
import { comoUsuario, sql } from "@/lib/db";
import { fechaLocalISO, formatFechaCorta, formatHora } from "@/lib/fechas";
import type { Bloqueo, Profesional } from "@/lib/tipos";
import { BotonEliminarBloqueo, FormularioBloqueo } from "./formulario";

export const metadata: Metadata = { title: "Ausencias" };

export default async function PaginaBloqueos() {
  const { negocio, perfil, esDueno, userId } = await requerirPanel();
  const tz = negocio.zona_horaria;

  const [profesionales, lista] = await comoUsuario(userId, (tx) =>
    Promise.all([
      tx.varios<Pick<Profesional, "id" | "nombre">>(sql`
        select id, nombre from public.profesionales where negocio_id = ${negocio.id} order by orden, nombre`),
      // RLS: el empleado solo recibe los suyos. Los ocupados que vienen de Google
      // se administran desde el propio calendario.
      tx.varios<Bloqueo>(sql`
        select id, profesional_id, inicio, fin, motivo, origen from public.bloqueos
        where negocio_id = ${negocio.id} and origen = 'manual' and fin >= now()
        order by inicio`),
    ]),
  );
  const nombres = new Map(profesionales.map((p) => [p.id, p.nombre]));

  const puedeCargar = esDueno ? profesionales.length > 0 : Boolean(perfil.profesional_id);

  return (
    <div className="max-w-3xl space-y-6">
      <EncabezadoPagina
        titulo="Ausencias"
        descripcion="Vacaciones, feriados o turnos que no querés ofrecer. Esos horarios no se muestran a los clientes."
      />

      <Tarjeta>
        <h2 className="mb-4 text-lg font-bold">Nueva ausencia</h2>
        {puedeCargar ? (
          <FormularioBloqueo
            profesionales={profesionales}
            fijo={esDueno ? undefined : (perfil.profesional_id ?? undefined)}
            hoy={fechaLocalISO(new Date(), tz)}
          />
        ) : (
          <Aviso tipo="alerta">
            {esDueno ? "Primero agregá profesionales." : "Tu usuario no está vinculado a una agenda. Pedile al dueño que lo vincule."}
          </Aviso>
        )}
      </Tarjeta>

      <section>
        <h2 className="mb-3 font-bold">Próximas ausencias</h2>
        {lista.length === 0 ? (
          <Vacio titulo="No hay ausencias cargadas" />
        ) : (
          <ul className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
            {lista.map((b) => (
              <li key={b.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    <span className="inline-block first-letter:uppercase">{formatFechaCorta(b.inicio, tz)}</span> {formatHora(b.inicio, tz)} →{" "}
                    <span className="inline-block first-letter:uppercase">{formatFechaCorta(b.fin, tz)}</span> {formatHora(b.fin, tz)}
                  </p>
                  <p className="truncate text-sm text-zinc-500">
                    {nombres.get(b.profesional_id) ?? "Profesional"}
                    {b.motivo ? ` · ${b.motivo}` : ""}
                  </p>
                </div>
                <BotonEliminarBloqueo id={b.id} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
