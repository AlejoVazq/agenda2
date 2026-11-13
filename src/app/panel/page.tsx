import type { Metadata } from "next";
import Link from "next/link";
import { Aviso, BotonLink, EncabezadoPagina, Insignia, Tarjeta, Vacio } from "@/components/ui";
import { BotonCopiar } from "@/components/copiar";
import { requerirPanel } from "@/lib/auth";
import { comoUsuario, sql } from "@/lib/db";
import { turnosEnRango } from "@/lib/datos-panel";
import { env } from "@/lib/env";
import { fechaLocalISO, formatFechaLarga, formatHora, localADate, sumarDias } from "@/lib/fechas";
import { ESTADOS_TURNO } from "@/lib/tipos";

export const metadata: Metadata = { title: "Panel" };

export default async function InicioPanel({ searchParams }: PageProps<"/panel">) {
  const { bienvenida } = await searchParams;
  const { perfil, negocio, esDueno, userId } = await requerirPanel();
  const tz = negocio.zona_horaria;
  const hoy = fechaLocalISO(new Date(), tz);

  const turnosHoy = await turnosEnRango(localADate(hoy, "00:00", tz), localADate(sumarDias(hoy, 1), "00:00", tz));
  const proximos = await turnosEnRango(localADate(sumarDias(hoy, 1), "00:00", tz), localADate(sumarDias(hoy, 8), "00:00", tz));

  const linkPublico = `${env.siteUrl}/n/${negocio.slug}`;

  // Checklist de configuración (solo dueño).
  let pasos: { texto: string; hecho: boolean; href: string }[] = [];
  let aDevolver: { id: string; inicio: string; cliente: { nombre: string } | null }[] = [];
  if (esDueno) {
    const [conteo, devoluciones] = await comoUsuario(userId, (tx) =>
      Promise.all([
        tx.uno<{ servicios: number; profesionales: number; horarios: number; asignaciones: number }>(sql`
          select
            (select count(*) from public.servicios where negocio_id = ${negocio.id} and activo) as servicios,
            (select count(*) from public.profesionales where negocio_id = ${negocio.id} and activo) as profesionales,
            (select count(*) from public.horarios_profesional where negocio_id = ${negocio.id}) as horarios,
            (select count(*) from public.profesional_servicio where negocio_id = ${negocio.id}) as asignaciones`),
        tx.varios<(typeof aDevolver)[number]>(sql`
          select t.id, t.inicio, json_build_object('nombre', coalesce(t.nombre_reserva, c.nombre)) as cliente
          from public.turnos t
          left join public.clientes c on c.id = t.cliente_id
          where t.negocio_id = ${negocio.id} and t.pago_estado = 'reembolsar'
          limit 10`),
      ]),
    );
    aDevolver = devoluciones;
    pasos = [
      { texto: "Cargá tus servicios con duración y precio", hecho: (conteo?.servicios ?? 0) > 0, href: "/panel/servicios" },
      { texto: "Agregá a las personas que atienden", hecho: (conteo?.profesionales ?? 0) > 0, href: "/panel/profesionales" },
      { texto: "Asigná qué servicios hace cada profesional", hecho: (conteo?.asignaciones ?? 0) > 0, href: "/panel/profesionales" },
      { texto: "Definí los horarios de atención", hecho: (conteo?.horarios ?? 0) > 0, href: "/panel/profesionales" },
    ];
  }
  const pendientes = pasos.filter((p) => !p.hecho);
  const siguiente = proximoTurno([...turnosHoy, ...proximos]);

  return (
    <>
      <EncabezadoPagina
        titulo={`¡Hola, ${perfil.nombre.split(" ")[0]}!`}
        descripcion={<span className="inline-block first-letter:uppercase">{formatFechaLarga(new Date(), tz)}</span>}
        acciones={<BotonLink href="/panel/agenda?nuevo=1">+ Nuevo turno</BotonLink>}
      />

      {bienvenida ? (
        <Aviso tipo="exito" className="mb-6">
          ¡Listo! Tu negocio ya está creado. Completá estos pasos y compartí tu link de reservas.
        </Aviso>
      ) : null}

      {aDevolver.length ? (
        <Aviso tipo="alerta" className="mb-6">
          <p className="font-semibold">
            {aDevolver.length === 1 ? "Hay una seña para devolver" : `Hay ${aDevolver.length} señas para devolver`}
          </p>
          <p className="mt-0.5">Se cobraron pero el turno no quedó vigente (por ejemplo, se pagó fuera de plazo).</p>
          <ul className="mt-2 space-y-1">
            {aDevolver.map((t) => (
              <li key={t.id}>
                <Link href={`/panel/turnos/${t.id}`} className="font-semibold underline">
                  {t.cliente?.nombre ?? "Cliente"} · {formatFechaLarga(t.inicio, tz)}
                </Link>
              </li>
            ))}
          </ul>
        </Aviso>
      ) : null}

      {esDueno && pendientes.length > 0 ? (
        <Tarjeta className="mb-6 border-marca-200 bg-marca-50/50">
          <h2 className="text-lg font-bold">Terminá de configurar tu agenda</h2>
          <p className="mt-0.5 text-sm text-zinc-600">
            {pasos.length - pendientes.length} de {pasos.length} pasos completos
          </p>
          <ul className="mt-4 space-y-2">
            {pasos.map((p) => (
              <li key={p.texto}>
                <Link href={p.href} className="flex items-center gap-3 rounded-xl bg-white px-3 py-2.5 text-sm hover:bg-marca-50">
                  <span
                    className={
                      p.hecho
                        ? "grid size-5 place-items-center rounded-full bg-emerald-500 text-[11px] text-white"
                        : "size-5 rounded-full border-2 border-zinc-300"
                    }
                  >
                    {p.hecho ? "✓" : null}
                  </span>
                  <span className={p.hecho ? "text-zinc-500 line-through" : "font-medium"}>{p.texto}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Tarjeta>
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Dato valor={turnosHoy.length} texto={turnosHoy.length === 1 ? "turno hoy" : "turnos hoy"} />
        <Dato valor={proximos.length} texto="en los próximos 7 días" />
        <Dato
          className="col-span-2 sm:col-span-1"
          valor={siguiente ? formatHora(siguiente.inicio, tz) : "—"}
          texto={
            siguiente
              ? `Próximo: ${siguiente.nombre_reserva ?? siguiente.cliente?.nombre ?? "Cliente"}`
              : "Sin turnos por delante"
          }
          destacado
        />
      </div>

      <div className="relative mb-8 flex flex-col gap-4 overflow-hidden rounded-3xl bg-noche bg-[radial-gradient(ellipse_70%_120%_at_100%_0%,rgb(79_146_114/0.55),transparent),radial-gradient(ellipse_50%_100%_at_0%_100%,rgb(226_98_43/0.22),transparent)] p-5 text-white sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="fondo-puntos pointer-events-none absolute inset-0 opacity-60" aria-hidden />
        <div className="relative min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-acento-300">Tu link de reservas</p>
          <a href={linkPublico} target="_blank" className="mt-1 block truncate font-display text-lg font-semibold hover:underline">
            {linkPublico.replace(/^https?:\/\//, "")}
          </a>
          <p className="mt-0.5 text-sm text-white/60">Compartilo en Instagram, WhatsApp y Google.</p>
        </div>
        <div className="relative flex shrink-0 gap-2">
          <BotonCopiar texto={linkPublico} />
          <a
            className="inline-flex h-9 items-center rounded-lg bg-emerald-500 px-3 text-sm font-semibold text-white transition hover:bg-emerald-600"
            href={`https://wa.me/?text=${encodeURIComponent(`Reservá tu turno en ${negocio.nombre}: ${linkPublico}`)}`}
            target="_blank"
          >
            Compartir
          </a>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 flex items-center gap-2 font-bold">
            Hoy <Insignia color="violeta">{turnosHoy.length}</Insignia>
          </h2>
          {turnosHoy.length === 0 ? (
            <Vacio titulo="No hay turnos para hoy" />
          ) : (
            <ListaTurnos turnos={turnosHoy} tz={tz} />
          )}
        </section>
        <section>
          <h2 className="mb-3 flex items-center gap-2 font-bold">
            Próximos 7 días <Insignia>{proximos.length}</Insignia>
          </h2>
          {proximos.length === 0 ? (
            <Vacio titulo="Sin turnos próximos" descripcion="Compartí tu link para empezar a recibir reservas." />
          ) : (
            <ListaTurnos turnos={proximos.slice(0, 10)} tz={tz} conFecha />
          )}
          {proximos.length > 10 ? (
            <Link href="/panel/turnos" className="mt-3 inline-block text-sm font-semibold text-marca-700 hover:underline">
              Ver todos →
            </Link>
          ) : null}
        </section>
      </div>
    </>
  );
}

function ListaTurnos({
  turnos,
  tz,
  conFecha,
}: {
  turnos: Awaited<ReturnType<typeof turnosEnRango>>;
  tz: string;
  conFecha?: boolean;
}) {
  return (
    <ul className="divide-y divide-zinc-100 overflow-hidden rounded-3xl border border-zinc-200/80 bg-white shadow-suave">
      {turnos.map((t) => (
        <li key={t.id}>
          <Link href={`/panel/turnos/${t.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-marca-50/40">
            <span className="h-10 w-1 shrink-0 rounded-full" style={{ background: t.profesional?.color ?? "#2f7556" }} />
            <div className="w-14 shrink-0">
              <p className="font-bold tabular-nums">{formatHora(t.inicio, tz)}</p>
              {conFecha ? (
                <p className="text-xs text-zinc-500 first-letter:uppercase">
                  {new Intl.DateTimeFormat("es-AR", { weekday: "short", day: "numeric", timeZone: tz }).format(new Date(t.inicio))}
                </p>
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{t.nombre_reserva ?? t.cliente?.nombre ?? "Cliente"}</p>
              <p className="truncate text-sm text-zinc-500">
                {t.servicio?.nombre} · {t.profesional?.nombre}
              </p>
            </div>
            {t.pago_estado === "pendiente" ? (
              <Insignia color="ambar">Falta seña</Insignia>
            ) : t.estado === "pendiente" ? (
              <Insignia color="ambar">{ESTADOS_TURNO[t.estado]}</Insignia>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Dato({
  valor,
  texto,
  destacado,
  className,
}: {
  valor: string | number;
  texto: string;
  destacado?: boolean;
  className?: string;
}) {
  return (
    <div
      className={
        (destacado
          ? "border-acento-200 bg-gradient-to-br from-acento-50 to-white "
          : "border-zinc-200/80 bg-white ") +
        "rounded-3xl border px-4 py-3.5 shadow-suave " +
        (className ?? "")
      }
    >
      <p className={"font-display text-3xl font-bold tabular-nums " + (destacado ? "text-acento-600" : "text-tinta")}>{valor}</p>
      <p className="truncate text-xs font-medium text-zinc-500">{texto}</p>
    </div>
  );
}

/** El primer turno que todavía no empezó (fuera del render para no llamar a Date.now() en él). */
function proximoTurno<T extends { inicio: string; estado: string }>(turnos: T[]) {
  const ahora = Date.now();
  return turnos.find((t) => new Date(t.inicio).getTime() >= ahora && t.estado !== "cancelado");
}
