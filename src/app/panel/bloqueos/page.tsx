import type { Metadata } from "next";
import { Aviso, EncabezadoPagina, Tarjeta, Vacio } from "@/components/ui";
import { requerirPanel } from "@/lib/auth";
import { crearSupabaseServidor } from "@/lib/supabase/server";
import { fechaLocalISO, formatFechaCorta, formatHora } from "@/lib/fechas";
import type { Bloqueo, Profesional } from "@/lib/tipos";
import { BotonEliminarBloqueo, FormularioBloqueo } from "./formulario";

export const metadata: Metadata = { title: "Ausencias" };

export default async function PaginaBloqueos() {
  const { negocio, perfil, esDueno } = await requerirPanel();
  const tz = negocio.zona_horaria;
  const supabase = await crearSupabaseServidor();

  const [{ data: profs }, { data: bloqueos }] = await Promise.all([
    supabase.from("profesionales").select("id, nombre").eq("negocio_id", negocio.id).order("orden").order("nombre"),
    // RLS: el empleado solo recibe los suyos.
    supabase
      .from("bloqueos")
      .select("id, profesional_id, inicio, fin, motivo")
      .eq("negocio_id", negocio.id)
      .gte("fin", new Date().toISOString())
      .order("inicio"),
  ]);
  const profesionales = (profs ?? []) as Pick<Profesional, "id" | "nombre">[];
  const nombres = new Map(profesionales.map((p) => [p.id, p.nombre]));
  const lista = (bloqueos ?? []) as Bloqueo[];

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
                    <span className="capitalize">{formatFechaCorta(b.inicio, tz)}</span> {formatHora(b.inicio, tz)} →{" "}
                    <span className="capitalize">{formatFechaCorta(b.fin, tz)}</span> {formatHora(b.fin, tz)}
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
