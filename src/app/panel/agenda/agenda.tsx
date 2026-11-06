"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import FullCalendar, { type CalendarRef, type EventInput, type EventSourceFuncInfo } from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import listPlugin from "@fullcalendar/react/list";
import interactionPlugin from "@fullcalendar/react/interaction";
import formaTheme from "@fullcalendar/react/themes/forma";
import esLocale from "@fullcalendar/react/locales/es";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/forma/theme.css";
import "@fullcalendar/react/themes/forma/palettes/purple.css";
import { Modal } from "@/components/modal";
import { Aviso, Boton, Insignia, Select } from "@/components/ui";
import { fechaLocalISO, formatFechaLarga, formatHora, formatPrecio } from "@/lib/fechas";
import { linkWhatsAppCliente } from "@/lib/whatsapp";
import { ESTADOS_TURNO, type EstadoTurno, type Profesional, type Servicio } from "@/lib/tipos";
import type { EventoAgenda } from "@/lib/datos-panel";
import { cambiarEstadoTurno, moverTurno } from "./acciones";
import { FormularioTurno, type ValoresIniciales } from "./formulario-turno";

type Props = {
  tz: string;
  esDueno: boolean;
  miProfesionalId: string | null;
  profesionales: Pick<Profesional, "id" | "nombre" | "color">[];
  servicios: Pick<Servicio, "id" | "nombre" | "duracion_min">[];
  asignaciones: { profesional_id: string; servicio_id: string }[];
  abrirNuevo: boolean;
  nombreNegocio: string;
};

const COLOR_ESTADO: Record<EstadoTurno, "ambar" | "verde" | "rojo" | "gris"> = {
  pendiente: "ambar",
  confirmado: "verde",
  cancelado: "rojo",
  completado: "gris",
  ausente: "rojo",
};

export function Agenda(props: Props) {
  const { tz, esDueno, miProfesionalId, profesionales, servicios, asignaciones, nombreNegocio } = props;
  const calendario = useRef<CalendarRef>(null);
  const [filtro, setFiltro] = useState<string>(esDueno ? "" : (miProfesionalId ?? ""));
  const [seleccionado, setSeleccionado] = useState<EventoAgenda | null>(null);
  const [nuevo, setNuevo] = useState<ValoresIniciales | null>(
    props.abrirNuevo ? { fecha: fechaLocalISO(new Date(), tz), hora: "10:00", profesional_id: miProfesionalId ?? undefined } : null,
  );
  const [aviso, setAviso] = useState<{ tipo: "error" | "exito"; texto: string } | null>(null);
  const [pendiente, iniciar] = useTransition();
  const [esMovil, setEsMovil] = useState(false);
  const [confirmarCancelar, setConfirmarCancelar] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const actualizar = () => setEsMovil(mq.matches);
    actualizar();
    mq.addEventListener("change", actualizar);
    return () => mq.removeEventListener("change", actualizar);
  }, []);

  useEffect(() => {
    calendario.current?.getApi().changeView(esMovil ? "timeGridDay" : "timeGridWeek");
  }, [esMovil]);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 4000);
    return () => clearTimeout(t);
  }, [aviso]);

  const refrescar = useCallback(() => calendario.current?.getApi().refetchEvents(), []);

  const cargarEventos = useCallback(
    async (info: EventSourceFuncInfo): Promise<EventInput[]> => {
      const parametros = new URLSearchParams({ desde: info.start.toISOString(), hasta: info.end.toISOString() });
      if (filtro) parametros.set("profesional_id", filtro);
      const respuesta = await fetch(`/api/agenda/eventos?${parametros}`, { cache: "no-store" });
      if (!respuesta.ok) throw new Error(`Error ${respuesta.status} al cargar la agenda`);
      const eventos: EventoAgenda[] = await respuesta.json();
      return eventos.map((e) => ({
        id: e.id,
        title: e.titulo,
        start: e.inicio,
        end: e.fin,
        color: e.color,
        display: e.tipo === "bloqueo" ? "background" : undefined,
        editable:
          (e.turno?.estado === "pendiente" || e.turno?.estado === "confirmado") && (esDueno || e.profesional_id === miProfesionalId),
        extendedProps: { evento: e },
      }));
    },
    [filtro, esDueno, miProfesionalId],
  );

  // Se registra acá y no con la prop `events`: con la prop, FullCalendar pide los
  // eventos al renderizar y la respuesta puede llegar antes de que se monte.
  useEffect(() => {
    const fuente = calendario.current?.getApi().addEventSource(cargarEventos);
    return () => fuente?.remove();
  }, [cargarEventos]);

  function abrirNuevo(inicio: Date) {
    if (!puedeAgendar) return;
    setNuevo({
      fecha: fechaLocalISO(inicio, tz),
      hora: formatHora(inicio, tz),
      profesional_id: filtro || miProfesionalId || undefined,
    });
  }

  function cambiarEstado(id: string, estado: EstadoTurno) {
    setConfirmarCancelar(false);
    iniciar(async () => {
      const r = await cambiarEstadoTurno({ id, estado });
      setAviso(r.error ? { tipo: "error", texto: r.error } : { tipo: "exito", texto: r.mensaje ?? "Listo" });
      if (!r.error) {
        setSeleccionado(null);
        refrescar();
      }
    });
  }

  const profesionalesParaNuevo = esDueno ? profesionales : profesionales.filter((p) => p.id === miProfesionalId);
  const puedeAgendar = profesionalesParaNuevo.length > 0 && servicios.length > 0;
  const turno = seleccionado?.turno;
  const yaEmpezo = turno ? new Date(turno.inicio) <= new Date() : false;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {esDueno && profesionales.length > 1 ? (
          <Select
            aria-label="Filtrar por profesional"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            className="w-auto min-w-44"
          >
            <option value="">Todo el equipo</option>
            {profesionales.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </Select>
        ) : null}
        <div className="flex-1" />
        <Boton
          disabled={!puedeAgendar}
          onClick={() =>
            setNuevo({ fecha: fechaLocalISO(new Date(), tz), hora: "10:00", profesional_id: filtro || miProfesionalId || undefined })
          }
        >
          + Nuevo turno
        </Boton>
      </div>

      {esDueno && profesionales.length > 1 ? (
        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600">
          {profesionales.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-full" style={{ background: p.color }} />
              {p.nombre}
            </span>
          ))}
        </div>
      ) : null}

      {aviso ? (
        <Aviso tipo={aviso.tipo} className="fixed inset-x-4 bottom-24 z-40 shadow-lg sm:inset-x-auto sm:right-6 sm:w-96 lg:bottom-6">
          {aviso.texto}
        </Aviso>
      ) : null}

      <div className="rounded-2xl border border-zinc-200 bg-white p-2 sm:p-4">
        <FullCalendar
          ref={calendario}
          plugins={[formaTheme, dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          locale={esLocale}
          timeZone={tz}
          initialView="timeGridWeek"
          headerToolbar={{ start: "prev,next today", center: "title", end: "timeGridDay,timeGridWeek,listWeek" }}
          height="auto"
          allDaySlot={false}
          nowIndicator
          slotMinTime="07:00:00"
          slotMaxTime="23:00:00"
          slotDuration="00:15:00"
          scrollTime="08:00:00"
          firstDay={1}
          editable
          selectable
          longPressDelay={350}
          // Solo impide superponer turnos del mismo profesional (la base lo valida igual).
          eventOverlap={(fijo, movido) =>
            fijo.display === "background" ||
            (fijo.extendedProps.evento as EventoAgenda | undefined)?.profesional_id !==
              (movido?.extendedProps.evento as EventoAgenda | undefined)?.profesional_id
          }
          eventSourceFailure={() => setAviso({ tipo: "error", texto: "No pudimos cargar la agenda. Recargá la página." })}
          eventClick={(info) => {
            const ev = info.event.extendedProps.evento as EventoAgenda | undefined;
            if (ev?.tipo === "turno") setSeleccionado(ev);
          }}
          // En pantallas táctiles, select pide mantener apretado; dateClick responde a un toque.
          dateClick={(info) => abrirNuevo(info.date)}
          select={(info) => {
            abrirNuevo(info.start);
            calendario.current?.getApi().unselect();
          }}
          eventDrop={async (info) => {
            const r = await moverTurno({
              id: info.event.id,
              inicio: info.event.start!.toISOString(),
              fin: info.event.end!.toISOString(),
            });
            if (r.error) {
              info.revert();
              setAviso({ tipo: "error", texto: r.error });
            } else {
              setAviso({ tipo: "exito", texto: `Turno movido a las ${formatHora(info.event.start!, tz)}` });
              refrescar();
            }
          }}
          eventResize={async (info) => {
            const r = await moverTurno({
              id: info.event.id,
              inicio: info.event.start!.toISOString(),
              fin: info.event.end!.toISOString(),
            });
            if (r.error) {
              info.revert();
              setAviso({ tipo: "error", texto: r.error });
            } else {
              refrescar();
            }
          }}
        />
      </div>

      <Modal abierto={Boolean(nuevo)} onCerrar={() => setNuevo(null)} titulo="Nuevo turno">
        {nuevo ? (
          <FormularioTurno
            key={`${nuevo.fecha}-${nuevo.hora}`}
            profesionales={profesionalesParaNuevo}
            servicios={servicios}
            asignaciones={asignaciones}
            inicial={nuevo}
            onListo={() => {
              setNuevo(null);
              setAviso({ tipo: "exito", texto: "Turno agendado." });
              refrescar();
            }}
          />
        ) : null}
      </Modal>

      <Modal
        abierto={Boolean(turno)}
        onCerrar={() => {
          setSeleccionado(null);
          setConfirmarCancelar(false);
        }}
        titulo={turno?.nombre_reserva ?? turno?.cliente?.nombre ?? "Turno"}
      >
        {turno ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Insignia color={COLOR_ESTADO[turno.estado]}>{ESTADOS_TURNO[turno.estado]}</Insignia>
              {turno.origen === "online" ? <Insignia color="violeta">Reserva online</Insignia> : null}
            </div>
            <dl className="space-y-2 text-sm">
              <Fila titulo="Cuándo">
                <span className="inline-block first-letter:uppercase">{formatFechaLarga(turno.inicio, tz)}</span>, {formatHora(turno.inicio, tz)} a{" "}
                {formatHora(turno.fin, tz)} h
              </Fila>
              <Fila titulo="Servicio">{turno.servicio?.nombre}</Fila>
              <Fila titulo="Profesional">{turno.profesional?.nombre}</Fila>
              {turno.precio !== null ? <Fila titulo="Precio">{formatPrecio(turno.precio)}</Fila> : null}
              <Fila titulo="Celular">{turno.cliente?.telefono}</Fila>
              {turno.cliente?.email ? <Fila titulo="Email">{turno.cliente.email}</Fila> : null}
              {turno.notas ? <Fila titulo="Notas">{turno.notas}</Fila> : null}
            </dl>
            {turno.cliente?.telefono ? (
              <a
                href={linkWhatsAppCliente(
                  turno.cliente.telefono,
                  `Hola ${(turno.nombre_reserva ?? turno.cliente.nombre).split(" ")[0]}! Te escribimos de ${nombreNegocio} por tu turno del ${formatFechaLarga(turno.inicio, tz)} a las ${formatHora(turno.inicio, tz)} h.`,
                )}
                target="_blank"
                className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                Escribir por WhatsApp
              </a>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              {turno.estado === "pendiente" ? (
                <Boton disabled={pendiente} onClick={() => cambiarEstado(turno.id, "confirmado")}>
                  Confirmar
                </Boton>
              ) : null}
              {yaEmpezo && turno.estado === "confirmado" ? (
                <Boton variante="secundario" disabled={pendiente} onClick={() => cambiarEstado(turno.id, "completado")}>
                  Marcar atendido
                </Boton>
              ) : null}
              {yaEmpezo && (turno.estado === "pendiente" || turno.estado === "confirmado") ? (
                <Boton variante="secundario" disabled={pendiente} onClick={() => cambiarEstado(turno.id, "ausente")}>
                  No asistió
                </Boton>
              ) : null}
              {turno.estado === "pendiente" || turno.estado === "confirmado" ? (
                confirmarCancelar ? (
                  <Boton variante="peligro" disabled={pendiente} onClick={() => cambiarEstado(turno.id, "cancelado")}>
                    Sí, cancelar
                  </Boton>
                ) : (
                  <Boton variante="peligro" disabled={pendiente} onClick={() => setConfirmarCancelar(true)}>
                    Cancelar turno
                  </Boton>
                )
              ) : null}
            </div>
            <Link href={`/panel/turnos/${turno.id}`} className="block text-center text-sm font-semibold text-marca-700 hover:underline">
              Ver detalle completo
            </Link>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function Fila({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 text-zinc-500">{titulo}</dt>
      <dd className="min-w-0 font-medium">{children}</dd>
    </div>
  );
}
