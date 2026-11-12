import Link from "next/link";
import { BotonLink, Logo, cx } from "@/components/ui";
import { MARCA } from "@/lib/marca";
import { RUBROS } from "@/lib/tipos";
import { CelularReserva, Notificacion, PanelMaqueta } from "./_inicio/maquetas";

const ICONOS = {
  reloj: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  escudo: "M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6zM9 12l2 2 4-4",
  campana: "M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0",
  equipo: "M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 20v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  freno: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM4.9 4.9l14.2 14.2",
  grafico: "M3 3v18h18M8 17v-5M13 17V8M18 17v-8",
  link: "M10 14a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 10a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7",
  check: "m5 12 5 5L20 7",
  calendario: "M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM8 2v4M16 2v4M4 10h16",
  celular: "M7 3h10a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2",
  mas: "M12 5v14M5 12h14",
  flecha: "M5 12h14M13 6l6 6-6 6",
};

function Icono({ nombre, className }: { nombre: keyof typeof ICONOS; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={cx("size-5", className)} aria-hidden>
      <path d={ICONOS[nombre]} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const PASOS = [
  {
    titulo: "Creá tu cuenta",
    texto: "Cargá tus servicios con duración y precio, quiénes atienden y en qué horarios. Son unos minutos.",
  },
  {
    titulo: "Compartí tu link",
    texto: "Ponelo en la bio de Instagram, en tu estado de WhatsApp o en Google. Es tu página de reservas.",
  },
  {
    titulo: "Recibí los turnos",
    texto: "Tus clientes eligen servicio, profesional y horario. Vos los ves ordenados en tu agenda.",
  },
];

const PREGUNTAS = [
  {
    p: "¿Mis clientes tienen que descargar una app o crear una cuenta?",
    r: "No. Entran a tu link desde el celular, eligen el turno y dejan nombre, celular y mail. Nada más.",
  },
  {
    p: "¿Qué pasa si un cliente no puede venir?",
    r: "Cada reserva tiene su propio link para ver o cancelar el turno. Vos decidís hasta cuántas horas antes se puede cancelar online, y el horario vuelve a quedar libre para otro.",
  },
  {
    p: "¿Cómo ayuda con los que no vienen?",
    r: "Le mandamos un recordatorio por mail al cliente antes del turno. Además, cada mail tiene un límite de turnos futuros y, si alguien acumula inasistencias, solo puede tener un turno a la vez hasta que vos lo habilites.",
  },
  {
    p: "Somos varios atendiendo, ¿sirve?",
    r: "Sí. Cada profesional tiene sus servicios y horarios, y puede entrar con su propio usuario para ver solo su agenda. Vos ves todo el negocio.",
  },
  {
    p: "¿Qué pasa cuando terminan los 7 días de prueba?",
    r: "Seguís con un abono mensual fijo, sin comisiones por turno. Si no seguís, tus datos quedan guardados y podés volver cuando quieras.",
  },
  {
    p: "¿Puedo cargar turnos que me piden por teléfono o en persona?",
    r: "Sí. Desde tu agenda agregás, movés o cancelás turnos en segundos, y todo queda en el mismo lugar.",
  },
];

export default function Inicio() {
  const rubros = Object.entries(RUBROS)
    .filter(([clave]) => clave !== "otro")
    .map(([, nombre]) => nombre);

  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip">
      {/* --- Navegación --- */}
      <header className="sticky top-0 z-40 border-b border-transparent bg-fondo/75 backdrop-blur-xl supports-[backdrop-filter]:bg-fondo/60">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3.5 sm:px-6">
          <Link href="/" aria-label={MARCA.nombre}>
            <Logo />
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2">
            <a href="#como-funciona" className="hidden rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 hover:text-tinta md:block">
              Cómo funciona
            </a>
            <a href="#funciones" className="hidden rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 hover:text-tinta md:block">
              Funciones
            </a>
            <a href="#preguntas" className="hidden rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 hover:text-tinta md:block">
              Preguntas
            </a>
            <Link href="/login" className="rounded-lg px-3 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-100">
              Ingresar
            </Link>
            <BotonLink href="/registro" tamano="sm" variante="oscuro">
              Probar gratis
            </BotonLink>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* --- Hero --- */}
        <section className="relative">
          <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden>
            <div className="absolute -top-40 right-[-10%] size-[38rem] rounded-full bg-marca-300/40 blur-3xl" />
            <div className="absolute left-[-15%] top-40 size-[28rem] rounded-full bg-coral-200/50 blur-3xl" />
            <div className="absolute inset-0 bg-[linear-gradient(to_right,rgb(26_21_35/0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgb(26_21_35/0.04)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_75%)]" />
          </div>

          <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 pb-20 pt-10 sm:px-6 sm:pt-16 lg:grid-cols-[1.1fr_0.9fr] lg:gap-8 lg:pb-28 lg:pt-20">
            <div>
              <p className="inline-flex animate-aparecer items-center gap-2 rounded-full border border-zinc-200 bg-white/80 py-1 pl-1.5 pr-3.5 text-xs font-semibold text-zinc-700 shadow-suave backdrop-blur">
                <span className="rounded-full bg-tinta px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                  Nuevo
                </span>
                Turnos online hechos en Argentina
              </p>
              <h1 className="mt-6 animate-aparecer font-display text-[2.75rem] font-bold leading-[1.02] tracking-[-0.035em] retraso-1 sm:text-6xl lg:text-7xl">
                Tus clientes{" "}
                <span className="relative whitespace-nowrap">
                  <span className="relative z-10 bg-gradient-to-r from-marca-700 via-marca-600 to-coral-500 bg-clip-text text-transparent">
                    reservan solos.
                  </span>
                  <svg
                    viewBox="0 0 300 18"
                    preserveAspectRatio="none"
                    className="absolute -bottom-1.5 left-0 h-3 w-full text-coral-400/70 sm:-bottom-2"
                    aria-hidden
                  >
                    <path d="M3 13c60-8 140-11 294-6" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
                  </svg>
                </span>{" "}
                Vos, a lo tuyo.
              </h1>
              <p className="mt-6 max-w-xl animate-aparecer text-lg leading-relaxed text-zinc-600 retraso-2 sm:text-xl">
                La agenda online para peluquerías, barberías, uñas y estética. Tu página de reservas abierta las 24 horas,
                sin llamadas, sin mensajes a deshoras y sin turnos pisados.
              </p>
              <div className="mt-9 flex animate-aparecer flex-col gap-3 retraso-3 sm:flex-row sm:items-center">
                <BotonLink href="/registro" tamano="lg" className="group">
                  Probalo 7 días gratis
                  <Icono nombre="flecha" className="size-4 transition-transform group-hover:translate-x-0.5" />
                </BotonLink>
                <BotonLink href="#como-funciona" tamano="lg" variante="secundario">
                  Ver cómo funciona
                </BotonLink>
              </div>
              <ul className="mt-7 flex animate-aparecer flex-wrap gap-x-5 gap-y-2 text-sm text-zinc-600 retraso-4">
                {["Sin tarjeta para probar", "Lista en minutos", "Sin comisiones por turno"].map((t) => (
                  <li key={t} className="flex items-center gap-1.5">
                    <Icono nombre="check" className="size-4 text-emerald-600" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>

            {/* Maqueta: celular + notificaciones flotando */}
            <div className="relative mx-auto flex h-[34rem] w-full max-w-md animate-aparecer items-center justify-center retraso-3">
              <div className="absolute inset-x-6 bottom-6 top-10 rounded-[3rem] bg-gradient-to-br from-marca-400 via-marca-600 to-coral-400 shadow-flotante">
                <div className="fondo-puntos absolute inset-0 rounded-[3rem]" />
              </div>
              <CelularReserva className="relative rotate-[-3deg]" />
              <Notificacion
                className="absolute -left-2 top-2 animate-flotar sm:-left-12"
                tono="coral"
                icono={<Icono nombre="campana" className="size-4.5" />}
                titulo="Nuevo turno · 17:30"
                texto="Corte + barba con Nico"
              />
              <Notificacion
                className="absolute -right-2 bottom-4 animate-flotar [animation-delay:-3s] sm:-right-10"
                tono="verde"
                icono={<Icono nombre="check" className="size-4.5" />}
                titulo="Recordatorio enviado"
                texto="Lucas · mañana 10:15"
              />
            </div>
          </div>
        </section>

        {/* --- Rubros (cinta) --- */}
        <section className="border-y border-zinc-200/80 bg-white py-5" aria-label="Rubros">
          <div className="relative flex overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
            <ul className="flex shrink-0 animate-marquesina items-center gap-10 pr-10">
              {[...rubros, ...rubros, ...rubros, ...rubros].map((r, i) => (
                <li
                  key={i}
                  className="flex shrink-0 items-center gap-10 font-display text-lg font-semibold text-zinc-400"
                  aria-hidden={i >= rubros.length}
                >
                  {r}
                  <span className="size-1.5 rounded-full bg-coral-400" />
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* --- Cómo funciona --- */}
        <section id="como-funciona" className="scroll-mt-20">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
            <Encabezado
              etiqueta="Cómo funciona"
              titulo="De cero a recibir turnos, en una tarde"
              texto="No hace falta saber de tecnología. Si usás WhatsApp, usás esto."
            />
            <ol className="mt-14 grid gap-5 md:grid-cols-3">
              {PASOS.map((p, i) => (
                <li
                  key={p.titulo}
                  className="group relative overflow-hidden rounded-3xl border border-zinc-200/80 bg-white p-7 shadow-suave transition hover:-translate-y-0.5 hover:shadow-flotante"
                >
                  <span className="pointer-events-none absolute -bottom-10 right-3 font-display text-[9rem] font-bold leading-none text-zinc-100 transition-colors group-hover:text-marca-50">
                    {i + 1}
                  </span>
                  <span className="relative grid size-11 place-items-center rounded-2xl bg-tinta font-display text-lg font-bold text-white">
                    {i + 1}
                  </span>
                  <h3 className="relative mt-6 text-xl font-bold">{p.titulo}</h3>
                  <p className="relative mt-2 text-zinc-600">{p.texto}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* --- Funciones (bento) --- */}
        <section id="funciones" className="relative scroll-mt-20 overflow-hidden bg-noche text-white">
          <div className="relative mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
            <div className="pointer-events-none absolute -left-40 top-0 size-[30rem] rounded-full bg-marca-700/30 blur-3xl" aria-hidden />
            <div className="pointer-events-none absolute -right-40 bottom-0 size-[26rem] rounded-full bg-coral-500/15 blur-3xl" aria-hidden />
            <Encabezado
              oscuro
              etiqueta="Funciones"
              titulo="Todo lo que tu mostrador necesita"
              texto="Pensado para el día a día real de un local: rápido, claro y sin vueltas."
            />

            <div className="relative mt-14 grid gap-4 md:grid-cols-6">
              <Bento className="md:col-span-4" icono="link" titulo="Tu propia página de reservas">
                <p>Un link con el nombre de tu local, listo para compartir. Se ve perfecto en el celular y carga al instante.</p>
                <div className="mt-6 flex items-center gap-2 overflow-hidden rounded-2xl bg-white/5 p-2 pl-4 ring-1 ring-white/10">
                  <span className="truncate font-mono text-sm text-white/80">
                    agenda2.tech/n/<span className="text-coral-300">tu-negocio</span>
                  </span>
                  <span className="ml-auto shrink-0 rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-tinta">Copiar</span>
                </div>
              </Bento>
              <Bento className="md:col-span-2" icono="escudo" titulo="Cero turnos pisados">
                <p>Cada horario se bloquea apenas alguien reserva, aunque dos personas lo pidan al mismo tiempo.</p>
              </Bento>
              <Bento className="md:col-span-2" icono="campana" titulo="Recordatorios automáticos">
                <p>Confirmación y recordatorio por mail para cada turno, sin que tengas que escribirle a nadie.</p>
              </Bento>
              <Bento className="md:col-span-2" icono="freno" titulo="Freno a los faltazos">
                <p>Límite de turnos por cliente y, si alguien falta seguido, solo puede reservar de a uno.</p>
              </Bento>
              <Bento className="md:col-span-2" icono="equipo" titulo="Cada uno, su agenda">
                <p>Servicios y horarios por profesional. Tu equipo entra con su usuario y ve solo lo suyo.</p>
              </Bento>
              <Bento className="md:col-span-3" icono="grafico" titulo="Clientes y números claros">
                <p>Ficha de cada cliente con su historial, asistencia y notas. Estadísticas y exportación a planilla.</p>
              </Bento>
              <Bento className="md:col-span-3" icono="calendario" titulo="Agenda de día, semana y mes">
                <p>Cargá los turnos que te piden por teléfono, movelos, marcá ausencias y vacaciones. Todo en un lugar.</p>
              </Bento>
            </div>
          </div>
        </section>

        {/* --- Panel --- */}
        <section className="relative">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 sm:px-6 sm:py-28 lg:grid-cols-[0.85fr_1.15fr]">
            <div>
              <Encabezado
                alineado="izquierda"
                etiqueta="Tu panel"
                titulo="Abrís el celular y sabés cómo viene el día"
                texto="Turnos de hoy, los próximos, quién atiende a quién y cuánto se movió la semana. Desde la compu o desde el teléfono, entre cliente y cliente."
              />
              <ul className="mt-8 space-y-3">
                {[
                  "Funciona en cualquier celular, tablet o compu",
                  "Agregá o cancelá un turno en segundos",
                  "Datos protegidos y copias de seguridad diarias",
                ].map((t) => (
                  <li key={t} className="flex items-start gap-3 text-zinc-700">
                    <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-marca-100 text-marca-700">
                      <Icono nombre="check" className="size-3.5" />
                    </span>
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <div className="relative">
              <div className="absolute -inset-6 -z-10 rounded-[3rem] bg-gradient-to-tr from-marca-100 via-fondo to-coral-100" aria-hidden />
              <PanelMaqueta />
            </div>
          </div>
        </section>

        {/* Para la verificación de Google: la home explica para qué se pide acceso al calendario. */}
        <section id="google-calendar" className="scroll-mt-20 px-4 sm:px-6">
          <div className="mx-auto grid max-w-6xl gap-8 rounded-[2rem] border border-zinc-200/80 bg-white p-7 shadow-suave sm:p-10 md:grid-cols-[auto_1fr] md:items-start">
            <span className="grid size-14 place-items-center rounded-2xl bg-marca-50 text-marca-700">
              <Icono nombre="calendario" className="size-7" />
            </span>
            <div className="max-w-3xl">
              <h2 className="text-2xl font-bold sm:text-3xl">Tu agenda también en Google Calendar</h2>
              <p className="mt-3 text-zinc-600">
                Si querés, cada profesional puede conectar su Google Calendar. {MARCA.nombre} agrega ahí cada turno y lo
                actualiza si se mueve o se cancela. También mira cuándo está ocupado en su calendario (por ejemplo, un
                trámite o unas vacaciones) para no ofrecer esos horarios a los clientes.
              </p>
              <p className="mt-3 text-sm text-zinc-500">
                Es opcional y se puede desconectar en cualquier momento. Solo usamos el calendario principal de quien lo
                conecta, nunca leemos los títulos ni el contenido de sus eventos y no compartimos esos datos. Detalle en la{" "}
                <Link href="/privacidad#google" className="font-medium text-marca-700 underline underline-offset-2">
                  política de privacidad
                </Link>
                .
              </p>
            </div>
          </div>
        </section>

        {/* --- Precio --- */}
        <section id="precio" className="scroll-mt-20">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
            <Encabezado etiqueta="Precio" titulo="Un solo plan, con todo incluido" texto="Sin letra chica y sin cobrarte por cada turno." />
            <div className="mx-auto mt-12 max-w-3xl overflow-hidden rounded-[2rem] border border-zinc-200/80 bg-white shadow-flotante md:grid md:grid-cols-[1fr_1.1fr]">
              <div className="relative overflow-hidden bg-gradient-to-br from-marca-700 via-marca-800 to-noche p-8 text-white">
                <div className="fondo-puntos absolute inset-0" aria-hidden />
                <div className="relative">
                  <p className="text-sm font-semibold uppercase tracking-[0.14em] text-coral-300">Para empezar</p>
                  <p className="mt-3 font-display text-6xl font-bold tracking-tight">7 días</p>
                  <p className="mt-1 text-lg text-white/80">gratis, con todas las funciones.</p>
                  <p className="mt-6 text-sm text-white/70">
                    Después, un abono mensual fijo. Sin tarjeta para probar y sin permanencia.
                  </p>
                  <BotonLink href="/registro" tamano="lg" variante="secundario" className="mt-8 w-full border-0">
                    Crear mi agenda
                  </BotonLink>
                </div>
              </div>
              <ul className="space-y-3.5 p-8">
                {[
                  "Página de reservas con tu nombre",
                  "Turnos ilimitados",
                  "Todos tus profesionales",
                  "Recordatorios por mail",
                  "Límites contra los faltazos",
                  "Clientes, historial y estadísticas",
                  "Google Calendar (opcional)",
                  "Soporte por mail, en castellano",
                ].map((t) => (
                  <li key={t} className="flex items-center gap-3 text-zinc-700">
                    <span className="grid size-5 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700">
                      <Icono nombre="check" className="size-3.5" />
                    </span>
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* --- Preguntas --- */}
        <section id="preguntas" className="scroll-mt-20 border-t border-zinc-200/80 bg-white">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 sm:py-28 lg:grid-cols-[0.8fr_1.2fr]">
            <Encabezado
              alineado="izquierda"
              etiqueta="Preguntas"
              titulo="Lo que nos preguntan siempre"
              texto="¿Te quedó otra duda? Escribinos y te respondemos nosotros, no un robot."
            />
            <div className="divide-y divide-zinc-200/80 border-y border-zinc-200/80">
              {PREGUNTAS.map((q) => (
                <details key={q.p} className="group py-1">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-4 font-semibold [&::-webkit-details-marker]:hidden">
                    {q.p}
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-zinc-100 text-zinc-600 transition-transform duration-200 group-open:rotate-45 group-open:bg-marca-100 group-open:text-marca-700">
                      <Icono nombre="mas" className="size-4" />
                    </span>
                  </summary>
                  <p className="pb-5 pr-12 text-zinc-600">{q.r}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* --- Llamado final --- */}
        <section className="px-4 py-16 sm:px-6 sm:py-24">
          <div className="relative mx-auto max-w-6xl overflow-hidden rounded-[2.5rem] bg-noche bg-[radial-gradient(ellipse_60%_80%_at_0%_0%,rgb(106_67_246/0.55),transparent),radial-gradient(ellipse_50%_70%_at_100%_100%,rgb(255_106_61/0.35),transparent)] px-6 py-16 text-center text-white sm:px-12 sm:py-24">
            <div className="fondo-puntos pointer-events-none absolute inset-0" aria-hidden />
            <div className="relative">
              <h2 className="mx-auto max-w-2xl font-display text-4xl font-bold leading-[1.05] sm:text-6xl">
                Dejá de anotar turnos en un cuaderno.
              </h2>
              <p className="mx-auto mt-5 max-w-lg text-lg text-white/70">
                Creá tu agenda hoy y compartí el link esta misma tarde. Los primeros 7 días van por nuestra cuenta.
              </p>
              <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <BotonLink href="/registro" tamano="lg" variante="coral">
                  Empezar gratis
                </BotonLink>
                <BotonLink href="/login" tamano="lg" variante="fantasma" className="text-white hover:bg-white/10">
                  Ya tengo cuenta
                </BotonLink>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-200/80">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="space-y-2">
            <Logo />
            <p>{MARCA.lema}. Hecho en Argentina.</p>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2">
            <Link href="/login" className="hover:text-tinta">
              Ingresar
            </Link>
            <Link href="/registro" className="hover:text-tinta">
              Crear cuenta
            </Link>
            <Link href="/privacidad" className="hover:text-tinta">
              Privacidad
            </Link>
            <Link href="/terminos" className="hover:text-tinta">
              Términos
            </Link>
            <span>© {new Date().getFullYear()} {MARCA.nombre}</span>
          </nav>
        </div>
      </footer>
    </div>
  );
}

function Encabezado({
  etiqueta,
  titulo,
  texto,
  oscuro,
  alineado = "centro",
}: {
  etiqueta: string;
  titulo: string;
  texto?: string;
  oscuro?: boolean;
  alineado?: "centro" | "izquierda";
}) {
  return (
    <div className={cx("relative max-w-2xl", alineado === "centro" && "mx-auto text-center")}>
      <p className={cx("text-sm font-bold uppercase tracking-[0.16em]", oscuro ? "text-coral-300" : "text-coral-600")}>{etiqueta}</p>
      <h2 className="mt-3 text-4xl font-bold leading-[1.05] sm:text-5xl">{titulo}</h2>
      {texto ? <p className={cx("mt-4 text-lg", oscuro ? "text-white/65" : "text-zinc-600")}>{texto}</p> : null}
    </div>
  );
}

function Bento({
  icono,
  titulo,
  children,
  className,
}: {
  icono: keyof typeof ICONOS;
  titulo: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "group rounded-3xl bg-white/[0.04] p-7 ring-1 ring-white/10 transition hover:bg-white/[0.07] hover:ring-white/20",
        className,
      )}
    >
      <span className="grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-marca-500 to-marca-700 text-white shadow-[0_8px_20px_-8px_rgb(125_95_255/0.8)]">
        <Icono nombre={icono} />
      </span>
      <h3 className="mt-5 text-xl font-bold">{titulo}</h3>
      <div className="mt-2 text-white/65">{children}</div>
    </div>
  );
}
