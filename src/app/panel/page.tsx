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
          <h2 className="font-bold">Terminá de configurar tu agenda</h2>
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

      <Tarjeta className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Tu link de reservas</p>
          <a href={linkPublico} target="_blank" className="block truncate text-sm text-marca-700 hover:underline">
            {linkPublico.replace(/^https?:\/\//, "")}
          </a>
        </div>
        <div className="flex gap-2">
          <BotonCopiar texto={linkPublico} />
          <a
            className="inline-flex h-9 items-center rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700"
            href={`https://wa.me/?text=${encodeURIComponent(`Reservá tu turno en ${negocio.nombre}: ${linkPublico}`)}`}
            target="_blank"
          >
            Compartir
          </a>
        </div>
      </Tarjeta>

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
    <ul className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
      {turnos.map((t) => (
        <li key={t.id}>
          <Link href={`/panel/turnos/${t.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-50">
            <span className="h-10 w-1 shrink-0 rounded-full" style={{ background: t.profesional?.color ?? "#7434ee" }} />
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
