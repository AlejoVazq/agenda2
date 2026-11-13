"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { BotonEnviar, MensajeAccion, useFormulario } from "@/components/formularios";
import { Aviso, Campo, Input, cx } from "@/components/ui";
import { formatDuracion, formatFechaISO, formatFechaLarga, formatHora, formatPrecio, sumarDias } from "@/lib/fechas";
import type { NegocioPublico, ServicioPublico } from "@/lib/publico";
import type { EstadoAccion } from "@/lib/tipos";
import { consultarDias, consultarHorarios, reservar, type Horario } from "./acciones";

type Paso = "servicio" | "profesional" | "horario" | "datos";
const PASOS: Paso[] = ["servicio", "profesional", "horario", "datos"];
const CUALQUIERA = "cualquiera";

export function Reserva({ negocio, hoy }: { negocio: NegocioPublico; hoy: string }) {
  const tz = negocio.zona_horaria;
  const [servicio, setServicio] = useState<ServicioPublico | null>(null);
  const [profesionalId, setProfesionalId] = useState<string>(CUALQUIERA);
  const [dias, setDias] = useState<string[] | null>(null);
  const [fecha, setFecha] = useState<string | null>(null);
  const [horarios, setHorarios] = useState<Horario[] | null>(null);
  const [horario, setHorario] = useState<Horario | null>(null);
  // El paso va en la dirección (?paso=…) para que el botón atrás del celular vuelva al
  // paso anterior en lugar de salir de la página. Si falta lo elegido antes, se retrocede.
  const pedido = useSearchParams().get("paso") as Paso | null;
  const pasoUrl: Paso = pedido && PASOS.includes(pedido) ? pedido : "servicio";
  const paso: Paso = !servicio ? "servicio" : pasoUrl === "datos" && !horario ? "horario" : pasoUrl;
  function setPaso(nuevo: Paso, reemplazar = false) {
    const url = nuevo === "servicio" ? window.location.pathname : `?paso=${nuevo}`;
    if (reemplazar) window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);
  }
  const [cargandoDias, iniciarDias] = useTransition();
  const [cargandoHorarios, iniciarHorarios] = useTransition();
  const [avisoHorario, setAvisoHorario] = useState<string | null>(null);
  const [inicioIntentado, setInicioIntentado] = useState<string | null>(null);
  const { estado, accion, valor, intento } = useFormulario(async (prev: EstadoAccion, formData: FormData) => {
    const resultado = await reservar(prev, formData);
    setInicioIntentado(String(formData.get("inicio")));
    // Si otro cliente tomó el horario un instante antes, volver a elegir.
    if (resultado.error?.includes("horario")) {
      setAvisoHorario(resultado.error);
      setHorario(null);
      setHorarios(null);
      setPaso("horario", true);
    }
    return resultado;
  });

  const nombresProf = useMemo(() => new Map(negocio.profesionales.map((p) => [p.id, p.nombre])), [negocio]);
  const profesionalesDelServicio = (servicio?.profesional_ids ?? []).filter((id) => nombresProf.has(id));
  const horizonte = Math.min(negocio.anticipacion_max_dias + 1, 92);

  // Cargar días con disponibilidad al elegir servicio/profesional.
  useEffect(() => {
    if (paso !== "horario" || !servicio) return;
    let vigente = true; // descarta respuestas de selecciones anteriores
    iniciarDias(async () => {
      const disponibles = await consultarDias({
        negocio_id: negocio.id,
        servicio_id: servicio.id,
        profesional_id: profesionalId === CUALQUIERA ? null : profesionalId,
        desde: hoy,
        dias: horizonte,
      });
      if (!vigente) return;
      setDias(disponibles);
      setFecha((actual) => (actual && disponibles.includes(actual) ? actual : (disponibles[0] ?? null)));
    });
    return () => {
      vigente = false;
    };
  }, [paso, servicio, profesionalId, negocio.id, hoy, horizonte]);

  // Cargar horarios del día elegido.
  useEffect(() => {
    if (paso !== "horario" || !servicio || !fecha) return;
    let vigente = true;
    iniciarHorarios(async () => {
      const lista = await consultarHorarios({
        negocio_id: negocio.id,
        servicio_id: servicio.id,
        profesional_id: profesionalId === CUALQUIERA ? null : profesionalId,
        fecha,
      });
      if (vigente) setHorarios(lista);
    });
    return () => {
      vigente = false;
    };
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
      setProfesionalId(CUALQUIERA);
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
          <h2 id="t-servicio" className="mb-4 font-display text-xl font-bold">
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
                    className="group flex w-full items-center gap-3 rounded-2xl border border-zinc-200/90 bg-white p-4 text-left transition hover:-translate-y-px hover:border-marca-300 hover:shadow-flotante active:scale-[0.99]"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-tinta">{s.nombre}</p>
                      {s.descripcion ? <p className="mt-0.5 line-clamp-2 text-sm text-zinc-500">{s.descripcion}</p> : null}
                      <p className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-zinc-500">
                        <svg viewBox="0 0 24 24" fill="none" className="size-3.5" aria-hidden>
                          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                          <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                        {formatDuracion(s.duracion_min)}
                      </p>
                    </div>
                    {s.precio !== null ? (
                      <p className="shrink-0 rounded-full bg-marca-50 px-3 py-1 text-sm font-bold tabular-nums text-marca-800">
                        {formatPrecio(s.precio)}
                      </p>
                    ) : null}
                    <span
                      className="grid size-8 shrink-0 place-items-center rounded-full bg-zinc-100 text-zinc-500 transition group-hover:bg-marca-700 group-hover:text-white"
                      aria-hidden
                    >
                      <svg viewBox="0 0 24 24" fill="none" className="size-4">
                        <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {paso === "profesional" ? (
        <section aria-labelledby="t-prof">
          <h2 id="t-prof" className="mb-4 font-display text-xl font-bold">
            ¿Con quién?
          </h2>
          <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {[CUALQUIERA, ...profesionalesDelServicio].map((id) => {
              const nombre = id === CUALQUIERA ? "Cualquiera" : (nombresProf.get(id) ?? "");
              return (
                <li key={id}>
                  <button
                    onClick={() => elegirProfesional(id)}
                    className="flex w-full flex-col items-center gap-2 rounded-2xl border border-zinc-200/90 bg-white p-4 transition hover:-translate-y-px hover:border-marca-300 hover:shadow-flotante active:scale-[0.98]"
                  >
                    <span
                      className={cx(
                        "grid size-14 place-items-center rounded-full font-display text-xl font-bold",
                        id === CUALQUIERA
                          ? "bg-acento-100 text-acento-600"
                          : "bg-gradient-to-br from-marca-500 to-marca-800 text-white shadow-[0_8px_18px_-8px_rgb(31_77_58/0.7)]",
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
          <h2 id="t-horario" className="mb-4 font-display text-xl font-bold">
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
                        if (d === fecha) return;
                        setFecha(d);
                        setHorarios(null);
                      }}
                      className={cx(
                        "flex w-16 flex-col items-center rounded-2xl border py-2.5 transition",
                        activo
                          ? "border-marca-700 bg-marca-700 text-white shadow-[0_8px_18px_-8px_rgb(31_77_58/0.8)]"
                          : disponible
                            ? "border-zinc-200 bg-white hover:border-marca-300 hover:bg-marca-50/50"
                            : "border-transparent bg-zinc-100/70 text-zinc-300",
                        dias === null && "animate-pulse",
                      )}
                    >
                      <span className="text-[11px] font-semibold uppercase">
                        {formatFechaISO(d, { weekday: "short" }).replace(".", "")}
                      </span>
                      <span className="font-display text-xl font-bold leading-tight">{formatFechaISO(d, { day: "numeric" })}</span>
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
                {profesionalId !== CUALQUIERA && profesionalesDelServicio.length > 1 ? " Probá con otro profesional." : " Comunicate con el negocio."}
              </p>
            ) : fecha ? (
              <>
                <p className="mb-3 text-sm font-semibold text-zinc-700 first-letter:uppercase">
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
          <h2 id="t-datos" className="mb-1 font-display text-xl font-bold">
            Tus datos
          </h2>
          <p className="mb-4 text-sm text-zinc-600">No hace falta crear una cuenta.</p>
          <form key={intento} action={accion} className="space-y-4" noValidate>
            <input type="hidden" name="negocio_id" value={negocio.id} />
            <input type="hidden" name="servicio_id" value={servicio.id} />
            <input type="hidden" name="profesional_id" value={profesionalId} />
            <input type="hidden" name="inicio" value={horario.inicio} />
            {estado.error?.includes("horario") || inicioIntentado !== horario.inicio ? null : <MensajeAccion estado={estado} />}
            <Campo etiqueta="Nombre y apellido" htmlFor="nombre" errores={estado.errores?.nombre}>
              <Input id="nombre" name="nombre" autoComplete="name" defaultValue={valor("nombre")} required />
            </Campo>
            <Campo
              etiqueta="Celular"
              htmlFor="telefono"
              errores={estado.errores?.telefono}
              ayuda="Con código de área, sin 0 ni 15. Ej: 341 555 1234"
            >
              <Input id="telefono" name="telefono" type="tel" inputMode="tel" autoComplete="tel" defaultValue={valor("telefono")} required />
            </Campo>
            <Campo
              etiqueta="Email"
              htmlFor="email"
              errores={estado.errores?.email}
              ayuda="Para enviarte la confirmación y recordatorios."
            >
              <Input id="email" name="email" type="email" inputMode="email" autoComplete="email" defaultValue={valor("email")} required />
            </Campo>
            {servicio.sena ? (
              <div className="flex gap-3 rounded-2xl border border-sky-100 bg-sky-50 p-4 text-sm text-sky-950">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-sky-600 text-white" aria-hidden>
                  <svg viewBox="0 0 24 24" fill="none" className="size-5">
                    <rect x="3" y="6" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="2" />
                    <path d="M3 10h18M7 15h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </span>
                <p>
                  Para confirmar el turno se pide una <strong>seña de {formatPrecio(servicio.sena)}</strong> con Mercado Pago.
                  Te guardamos el horario {negocio.pago_plazo_min} minutos mientras pagás.
                </p>
              </div>
            ) : null}
            <BotonEnviar tamano="lg" className="w-full" pendiente={servicio.sena ? "Preparando el pago…" : "Reservando…"}>
              {servicio.sena ? "Continuar al pago" : "Confirmar turno"}
            </BotonEnviar>
            <p className="text-center text-xs text-zinc-500">
              {negocio.cancelacion_min_horas > 0
                ? `Podés cancelar online hasta ${negocio.cancelacion_min_horas} ${negocio.cancelacion_min_horas === 1 ? "hora" : "horas"} antes (o en los 15 minutos después de reservar).`
                : "Podés cancelar online hasta el momento del turno."}{" "}
              Usamos tus datos para gestionar tu turno y sus avisos.{" "}
              <Link href="/privacidad" target="_blank" className="underline">
                Ver privacidad
              </Link>
            </p>
          </form>
        </section>
      ) : null}
    </div>
  );
}

const NOMBRES_PASO: Record<Paso, string> = {
  servicio: "Servicio",
  profesional: "Profesional",
  horario: "Día y horario",
  datos: "Tus datos",
};

function Pasos({ paso }: { paso: Paso }) {
  const orden: Paso[] = ["servicio", "profesional", "horario", "datos"];
  const actual = orden.indexOf(paso);
  return (
    <div className="mb-5" aria-hidden>
      <p className="mb-2 flex items-center justify-between text-xs font-semibold text-zinc-500">
        <span>
          Paso {actual + 1} de {orden.length}
        </span>
        <span className="text-marca-700">{NOMBRES_PASO[paso]}</span>
      </p>
      <div className="flex gap-1.5">
        {orden.map((p, i) => (
          <span
            key={p}
            className={cx(
              "h-1.5 flex-1 rounded-full transition-colors duration-500",
              i < actual ? "bg-marca-600" : i === actual ? "bg-gradient-to-r from-marca-600 to-acento-500" : "bg-zinc-200",
            )}
          />
        ))}
      </div>
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
    <div className="mb-6 flex items-start gap-3 rounded-2xl bg-gradient-to-br from-marca-50 to-acento-50/70 p-4 ring-1 ring-marca-100">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-marca-700 shadow-suave" aria-hidden>
        <svg viewBox="0 0 24 24" fill="none" className="size-5">
          <path d="m5 12 5 5L20 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-bold text-marca-950">{servicio.nombre}</p>
        <p className="text-marca-900/80">
          {formatDuracion(servicio.duracion_min)}
          {servicio.precio !== null ? ` · ${formatPrecio(servicio.precio)}` : ""} · {profesional}
        </p>
        {servicio.sena ? <p className="text-marca-900/80">Seña: {formatPrecio(servicio.sena)}</p> : null}
        {horario ? (
          <p className="mt-1 font-semibold text-marca-900 first-letter:uppercase">
            {formatFechaLarga(horario.inicio, tz)} · {formatHora(horario.inicio, tz)} h
          </p>
        ) : null}
      </div>
      <button onClick={onCambiar} className="shrink-0 rounded-lg px-2 py-1 text-sm font-semibold text-marca-700 hover:bg-white">
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
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-400">{g.titulo}</p>
            <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {g.lista.map((h) => (
                <li key={h.inicio}>
                  <button
                    onClick={() => onElegir(h)}
                    className="w-full rounded-xl border border-zinc-200 bg-white py-3 text-sm font-semibold tabular-nums transition hover:border-marca-700 hover:bg-marca-700 hover:text-white active:scale-95"
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
        <span key={i} className="h-11 animate-pulse rounded-xl bg-zinc-100" />
      ))}
    </div>
  );
}
