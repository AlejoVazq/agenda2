"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { BotonEnviar, MensajeAccion } from "@/components/formularios";
import { Aviso, Campo, Input, cx } from "@/components/ui";
import { formatDuracion, formatFechaISO, formatFechaLarga, formatHora, formatPrecio, sumarDias } from "@/lib/fechas";
import type { NegocioPublico, ServicioPublico } from "@/lib/publico";
import type { EstadoAccion } from "@/lib/tipos";
import { consultarDias, consultarHorarios, reservar, type Horario } from "./acciones";

type Paso = "servicio" | "profesional" | "horario" | "datos";
const CUALQUIERA = "cualquiera";

export function Reserva({ negocio, hoy }: { negocio: NegocioPublico; hoy: string }) {
  const tz = negocio.zona_horaria;
  const [paso, setPaso] = useState<Paso>("servicio");
  const [servicio, setServicio] = useState<ServicioPublico | null>(null);
  const [profesionalId, setProfesionalId] = useState<string>(CUALQUIERA);
  const [dias, setDias] = useState<string[] | null>(null);
  const [fecha, setFecha] = useState<string | null>(null);
  const [horarios, setHorarios] = useState<Horario[] | null>(null);
  const [horario, setHorario] = useState<Horario | null>(null);
  const [cargandoDias, iniciarDias] = useTransition();
  const [cargandoHorarios, iniciarHorarios] = useTransition();
  const [avisoHorario, setAvisoHorario] = useState<string | null>(null);
  const [estado, accion] = useActionState(async (prev: EstadoAccion, formData: FormData) => {
    const resultado = await reservar(prev, formData);
    // Si otro cliente tomó el horario un instante antes, volver a elegir.
    if (resultado.error?.includes("horario")) {
      setAvisoHorario(resultado.error);
      setHorario(null);
      setHorarios(null);
      setPaso("horario");
    }
    return resultado;
  }, {});

  const nombresProf = useMemo(() => new Map(negocio.profesionales.map((p) => [p.id, p.nombre])), [negocio]);
  const profesionalesDelServicio = (servicio?.profesional_ids ?? []).filter((id) => nombresProf.has(id));
  const horizonte = Math.min(negocio.anticipacion_max_dias + 1, 62);

  // Cargar días con disponibilidad al elegir servicio/profesional.
  useEffect(() => {
    if (paso !== "horario" || !servicio) return;
    iniciarDias(async () => {
      const disponibles = await consultarDias({
        negocio_id: negocio.id,
        servicio_id: servicio.id,
        profesional_id: profesionalId === CUALQUIERA ? null : profesionalId,
        desde: hoy,
        dias: horizonte,
      });
      setDias(disponibles);
      setFecha((actual) => (actual && disponibles.includes(actual) ? actual : (disponibles[0] ?? null)));
    });
  }, [paso, servicio, profesionalId, negocio.id, hoy, horizonte]);

  // Cargar horarios del día elegido.
  useEffect(() => {
    if (paso !== "horario" || !servicio || !fecha) return;
    iniciarHorarios(async () => {
      setHorarios(
        await consultarHorarios({
          negocio_id: negocio.id,
          servicio_id: servicio.id,
          profesional_id: profesionalId === CUALQUIERA ? null : profesionalId,
          fecha,
        }),
      );
    });
  }, [paso, servicio, profesionalId, fecha, negocio.id]);


  function elegirServicio(s: ServicioPublico) {
    setServicio(s);
    setHorario(null);
    setDias(null);
    setHorarios(null);
    const profs = (s.profesional_ids ?? []).filter((id) => nombresProf.has(id));
    if (profs.length <= 1) {
      setProfesionalId(profs[0] ?? CUALQUIERA);
      setPaso("horario");
    } else {
      setPaso("profesional");
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function elegirProfesional(id: string) {
    setProfesionalId(id);
    setHorario(null);
    setDias(null);
    setHorarios(null);
    setPaso("horario");
  }

  function elegirHorario(h: Horario) {
    setAvisoHorario(null);
    setHorario(h);
    setPaso("datos");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const todosLosDias = useMemo(() => Array.from({ length: horizonte }, (_, i) => sumarDias(hoy, i)), [hoy, horizonte]);

  return (
    <div>
      <Pasos paso={paso} />

      {paso !== "servicio" && servicio ? (
        <Resumen
          servicio={servicio}
          profesional={profesionalId === CUALQUIERA ? "Cualquier profesional" : (nombresProf.get(profesionalId) ?? "")}
          horario={horario}
          tz={tz}
          onCambiar={() => {
            setPaso("servicio");
            setHorario(null);
          }}
        />
      ) : null}

      {paso === "servicio" ? (
        <section aria-labelledby="t-servicio">
          <h2 id="t-servicio" className="mb-3 text-lg font-bold">
            ¿Qué te querés hacer?
          </h2>
          {negocio.servicios.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-600">
              Este negocio todavía no publicó servicios para reservar online.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {negocio.servicios.map((s) => (
                <li key={s.id}>
                  <button
                    onClick={() => elegirServicio(s)}
                    className="flex w-full items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-4 text-left transition hover:border-marca-300 hover:shadow-md hover:shadow-marca-900/5 active:scale-[0.99]"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{s.nombre}</p>
                      {s.descripcion ? <p className="mt-0.5 line-clamp-2 text-sm text-zinc-500">{s.descripcion}</p> : null}
                      <p className="mt-1 text-sm text-zinc-500">{formatDuracion(s.duracion_min)}</p>
                    </div>
                    {s.precio !== null ? <p className="shrink-0 font-bold text-marca-800">{formatPrecio(s.precio)}</p> : null}
                    <span className="text-xl text-zinc-300">›</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {paso === "profesional" ? (
        <section aria-labelledby="t-prof">
          <h2 id="t-prof" className="mb-3 text-lg font-bold">
            ¿Con quién?
          </h2>
          <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {[CUALQUIERA, ...profesionalesDelServicio].map((id) => {
              const nombre = id === CUALQUIERA ? "Cualquiera" : (nombresProf.get(id) ?? "");
              return (
                <li key={id}>
                  <button
                    onClick={() => elegirProfesional(id)}
                    className="flex w-full flex-col items-center gap-2 rounded-2xl border border-zinc-200 bg-white p-4 transition hover:border-marca-300 active:scale-[0.98]"
                  >
                    <span
                      className={cx(
                        "grid size-12 place-items-center rounded-full text-lg font-bold",
                        id === CUALQUIERA ? "bg-zinc-100 text-zinc-500" : "bg-marca-100 text-marca-800",
                      )}
                    >
                      {id === CUALQUIERA ? "★" : nombre.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="text-sm font-semibold">{nombre}</span>
                    {id === CUALQUIERA ? <span className="-mt-1.5 text-xs text-zinc-500">Más horarios</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {paso === "horario" ? (
        <section aria-labelledby="t-horario">
          <h2 id="t-horario" className="mb-3 text-lg font-bold">
            Elegí día y horario
          </h2>
          {avisoHorario ? (
            <Aviso tipo="error" className="mb-3">
              {avisoHorario}
            </Aviso>
          ) : null}
          <div className="-mx-4 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
            <ul className="flex gap-2">
              {todosLosDias.map((d) => {
                const disponible = dias?.includes(d) ?? false;
                const activo = d === fecha;
                return (
                  <li key={d}>
                    <button
                      disabled={!disponible}
                      onClick={() => {
                        setFecha(d);
                        setHorarios(null);
                      }}
                      className={cx(
                        "flex w-16 flex-col items-center rounded-2xl border py-2.5 transition",
                        activo
                          ? "border-marca-700 bg-marca-700 text-white"
                          : disponible
                            ? "border-zinc-200 bg-white hover:border-marca-300"
                            : "border-transparent bg-zinc-100/70 text-zinc-300",
                        dias === null && "animate-pulse",
                      )}
                    >
                      <span className="text-[11px] font-semibold uppercase">
                        {formatFechaISO(d, { weekday: "short" }).replace(".", "")}
                      </span>
                      <span className="text-xl font-bold leading-tight">{formatFechaISO(d, { day: "numeric" })}</span>
                      <span className="text-[11px]">{formatFechaISO(d, { month: "short" }).replace(".", "")}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="mt-4">
            {cargandoDias || dias === null ? (
              <Cargando />
            ) : dias.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-600">
                No hay horarios disponibles en los próximos días.
                {profesionalId !== CUALQUIERA ? " Probá con otro profesional." : " Comunicate con el negocio."}
              </p>
            ) : fecha ? (
              <>
                <p className="mb-3 text-sm font-semibold capitalize text-zinc-700">
                  {formatFechaISO(fecha, { weekday: "long", day: "numeric", month: "long" })}
                </p>
                {cargandoHorarios || horarios === null ? (
                  <Cargando />
                ) : horarios.length === 0 ? (
                  <p className="text-sm text-zinc-600">Ya no quedan horarios este día. Elegí otro.</p>
                ) : (
                  <GrillaHorarios horarios={horarios} tz={tz} onElegir={elegirHorario} />
                )}
              </>
            ) : null}
          </div>
        </section>
      ) : null}

      {paso === "datos" && servicio && horario ? (
        <section aria-labelledby="t-datos">
          <h2 id="t-datos" className="mb-1 text-lg font-bold">
            Tus datos
          </h2>
          <p className="mb-4 text-sm text-zinc-600">No hace falta crear una cuenta.</p>
          <form action={accion} className="space-y-4" noValidate>
            <input type="hidden" name="negocio_id" value={negocio.id} />
            <input type="hidden" name="servicio_id" value={servicio.id} />
            <input type="hidden" name="profesional_id" value={profesionalId} />
            <input type="hidden" name="inicio" value={horario.inicio} />
            {estado.error?.includes("horario") ? null : <MensajeAccion estado={estado} />}
            <Campo etiqueta="Nombre y apellido" htmlFor="nombre" errores={estado.errores?.nombre}>
              <Input id="nombre" name="nombre" autoComplete="name" required />
            </Campo>
            <Campo
              etiqueta="Celular"
              htmlFor="telefono"
              errores={estado.errores?.telefono}
              ayuda="Con código de área, sin 0 ni 15. Ej: 341 555 1234"
            >
              <Input id="telefono" name="telefono" type="tel" inputMode="tel" autoComplete="tel" required />
            </Campo>
            <Campo
              etiqueta="Email"
              htmlFor="email"
              errores={estado.errores?.email}
              ayuda="Opcional. Para enviarte la confirmación y recordatorios."
            >
              <Input id="email" name="email" type="email" inputMode="email" autoComplete="email" />
            </Campo>
            <BotonEnviar tamano="lg" className="w-full" pendiente="Reservando…">
              Confirmar turno
            </BotonEnviar>
            <p className="text-center text-xs text-zinc-500">
              {negocio.cancelacion_min_horas > 0
                ? `Podés cancelar online hasta ${negocio.cancelacion_min_horas} ${negocio.cancelacion_min_horas === 1 ? "hora" : "horas"} antes.`
                : "Podés cancelar online hasta el momento del turno."}
            </p>
          </form>
        </section>
      ) : null}
    </div>
  );
}

function Pasos({ paso }: { paso: Paso }) {
  const orden: Paso[] = ["servicio", "profesional", "horario", "datos"];
  const actual = orden.indexOf(paso);
  return (
    <div className="mb-5 flex gap-1.5" aria-hidden>
      {orden.map((p, i) => (
        <span key={p} className={cx("h-1.5 flex-1 rounded-full", i <= actual ? "bg-marca-600" : "bg-zinc-200")} />
      ))}
    </div>
  );
}

function Resumen({
  servicio,
  profesional,
  horario,
  tz,
  onCambiar,
}: {
  servicio: ServicioPublico;
  profesional: string;
  horario: Horario | null;
  tz: string;
  onCambiar: () => void;
}) {
  return (
    <div className="mb-5 flex items-start gap-3 rounded-2xl bg-marca-50 p-4">
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-bold text-marca-950">{servicio.nombre}</p>
        <p className="text-marca-900/80">
          {formatDuracion(servicio.duracion_min)}
          {servicio.precio !== null ? ` · ${formatPrecio(servicio.precio)}` : ""} · {profesional}
        </p>
        {horario ? (
          <p className="mt-1 font-semibold capitalize text-marca-900">
            {formatFechaLarga(horario.inicio, tz)} · {formatHora(horario.inicio, tz)} h
          </p>
        ) : null}
      </div>
      <button onClick={onCambiar} className="shrink-0 text-sm font-semibold text-marca-700 hover:underline">
        Cambiar
      </button>
    </div>
  );
}

function GrillaHorarios({ horarios, tz, onElegir }: { horarios: Horario[]; tz: string; onElegir: (h: Horario) => void }) {
  const grupos: { titulo: string; lista: Horario[] }[] = [
    { titulo: "Mañana", lista: [] },
    { titulo: "Tarde", lista: [] },
    { titulo: "Noche", lista: [] },
  ];
  for (const h of horarios) {
    const hora = Number(formatHora(h.inicio, tz).slice(0, 2));
    grupos[hora < 12 ? 0 : hora < 19 ? 1 : 2].lista.push(h);
  }
  return (
    <div className="space-y-4">
      {grupos
        .filter((g) => g.lista.length)
        .map((g) => (
          <div key={g.titulo}>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-500">{g.titulo}</p>
            <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {g.lista.map((h) => (
                <li key={h.inicio}>
                  <button
                    onClick={() => onElegir(h)}
                    className="w-full rounded-xl border border-zinc-200 bg-white py-2.5 text-sm font-semibold tabular-nums transition hover:border-marca-500 hover:bg-marca-50 active:scale-95"
                  >
                    {formatHora(h.inicio, tz)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
    </div>
  );
}

function Cargando() {
  return (
    <div className="grid grid-cols-4 gap-2 sm:grid-cols-6" aria-label="Cargando">
      {Array.from({ length: 8 }).map((_, i) => (
        <span key={i} className="h-10 animate-pulse rounded-xl bg-zinc-100" />
      ))}
    </div>
  );
}
