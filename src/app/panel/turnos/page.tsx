import type { Metadata } from "next";
import Link from "next/link";
import { BotonLink, EncabezadoPagina, Insignia, Select, Vacio, clasesBoton } from "@/components/ui";
import { requerirPanel } from "@/lib/auth";
import { comoUsuario, sql } from "@/lib/db";
import { turnosEnRango } from "@/lib/datos-panel";
import { fechaLocalISO, formatFechaISO, formatHora, localADate, sumarDias } from "@/lib/fechas";
import { ESTADOS_TURNO, type EstadoTurno } from "@/lib/tipos";

export const metadata: Metadata = { title: "Turnos" };

const RANGOS = {
  proximos: "Próximos 30 días",
  hoy: "Hoy",
  semana: "Esta semana",
  pasados: "Últimos 30 días",
} as const;
type Rango = keyof typeof RANGOS;

const COLOR = { pendiente: "ambar", confirmado: "verde", cancelado: "rojo", completado: "gris", ausente: "rojo" } as const;

export default async function PaginaTurnos({ searchParams }: PageProps<"/panel/turnos">) {
  const sp = await searchParams;
  const { negocio, esDueno, userId } = await requerirPanel();
  const tz = negocio.zona_horaria;

  const rango: Rango = typeof sp.rango === "string" && Object.hasOwn(RANGOS, sp.rango) ? (sp.rango as Rango) : "proximos";
  const estado = typeof sp.estado === "string" && Object.hasOwn(ESTADOS_TURNO, sp.estado) ? (sp.estado as EstadoTurno) : null;
  const profesional = typeof sp.profesional === "string" && /^[0-9a-f-]{36}$/.test(sp.profesional) ? sp.profesional : undefined;

  const hoy = fechaLocalISO(new Date(), tz);
  const [desdeF, hastaF] = {
    proximos: [hoy, sumarDias(hoy, 31)],
    hoy: [hoy, sumarDias(hoy, 1)],
    semana: [hoy, sumarDias(hoy, 7)],
    pasados: [sumarDias(hoy, -30), sumarDias(hoy, 1)],
  }[rango];

  const [todos, profs] = await Promise.all([
    turnosEnRango(localADate(desdeF, "00:00", tz), localADate(hastaF, "00:00", tz), {
      profesionalId: profesional,
      incluirCancelados: true,
    }),
    esDueno
      ? comoUsuario(userId, (tx) =>
          tx.varios<{ id: string; nombre: string }>(sql`
            select id, nombre from public.profesionales where negocio_id = ${negocio.id} order by nombre`),
        )
      : Promise.resolve([] as { id: string; nombre: string }[]),
  ]);
  const turnos = (estado ? todos.filter((t) => t.estado === estado) : todos).sort((a, b) =>
    rango === "pasados" ? b.inicio.localeCompare(a.inicio) : a.inicio.localeCompare(b.inicio),
  );

  // Agrupar por día local.
  const porDia = new Map<string, typeof turnos>();
  for (const t of turnos) {
    const d = fechaLocalISO(t.inicio, tz);
    if (!porDia.has(d)) porDia.set(d, []);
    porDia.get(d)!.push(t);
  }

  return (
    <>
      <EncabezadoPagina
        titulo="Turnos"
        acciones={<BotonLink href="/panel/agenda?nuevo=1">+ Nuevo turno</BotonLink>}
      />

      <form className="mb-5 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <Select name="rango" defaultValue={rango} aria-label="Período" className="sm:w-auto">
          {Object.entries(RANGOS).map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
        </Select>
        <Select name="estado" defaultValue={estado ?? ""} aria-label="Estado" className="sm:w-auto">
          <option value="">Todos los estados</option>
          {Object.entries(ESTADOS_TURNO).map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
        </Select>
        {esDueno && (profs ?? []).length > 1 ? (
          <Select name="profesional" defaultValue={profesional ?? ""} aria-label="Profesional" className="col-span-2 sm:w-auto">
            <option value="">Todo el equipo</option>
            {(profs ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </Select>
        ) : null}
        <button className={clasesBoton("secundario", "md", "col-span-2 sm:col-span-1")}>Filtrar</button>
      </form>

      {turnos.length === 0 ? (
        <Vacio titulo="No hay turnos con estos filtros" />
      ) : (
        <div className="space-y-6">
          {[...porDia.entries()].map(([dia, lista]) => (
            <section key={dia}>
              <h2 className="mb-2 text-sm font-bold text-zinc-600 first-letter:uppercase">
                {formatFechaISO(dia, { weekday: "long", day: "numeric", month: "long" })}
              </h2>
              <ul className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
                {lista.map((t) => (
                  <li key={t.id}>
                    <Link href={`/panel/turnos/${t.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-50">
                      <span className="h-10 w-1 shrink-0 rounded-full" style={{ background: t.profesional?.color ?? "#2f7556" }} />
                      <p className="w-12 shrink-0 font-bold tabular-nums">{formatHora(t.inicio, tz)}</p>
                      <div className="min-w-0 flex-1">
                        <p className={t.estado === "cancelado" ? "truncate font-medium text-zinc-400 line-through" : "truncate font-medium"}>
                          {t.nombre_reserva ?? t.cliente?.nombre ?? "Cliente"}
                        </p>
                        <p className="truncate text-sm text-zinc-500">
                          {t.servicio?.nombre} · {t.profesional?.nombre}
                        </p>
                      </div>
                      {t.pago_estado === "pendiente" && t.estado !== "cancelado" ? (
                        <Insignia color="ambar">Falta seña</Insignia>
                      ) : t.pago_estado === "reembolsar" ? (
                        <Insignia color="ambar">Devolver seña</Insignia>
                      ) : null}
                      <Insignia color={COLOR[t.estado]}>{ESTADOS_TURNO[t.estado]}</Insignia>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
