import { cx } from "@/components/ui";

// Maquetas ilustrativas de la landing: muestran la app con datos inventados.
// Son HTML puro (sin capturas) para que se vean nítidas y livianas en cualquier pantalla.

const DIAS = [
  { d: "lun", n: 14, libre: true },
  { d: "mar", n: 15, libre: true, activo: true },
  { d: "mié", n: 16, libre: true },
  { d: "jue", n: 17, libre: false },
  { d: "vie", n: 18, libre: true },
];

const HORARIOS = ["15:00", "15:30", "16:00", "16:30", "17:00", "17:30", "18:00", "18:30"];

/** Celular con el portal de reservas de un negocio de ejemplo. */
export function CelularReserva({ className }: { className?: string }) {
  return (
    <div
      className={cx(
        "relative w-[17.5rem] rounded-[2.6rem] bg-noche p-2.5 shadow-[0_40px_80px_-24px_rgb(11_29_22/0.55),0_0_0_1px_rgb(255_255_255/0.06)_inset]",
        className,
      )}
      aria-hidden
    >
      <div className="relative overflow-hidden rounded-[2.1rem] bg-fondo">
        {/* Isla */}
        <div className="absolute left-1/2 top-2 z-10 h-5 w-20 -translate-x-1/2 rounded-full bg-noche" />

        <div className="relative overflow-hidden bg-noche px-4 pb-10 pt-10 text-white">
          <div className="absolute -right-10 -top-10 size-36 rounded-full bg-marca-600/50 blur-2xl" />
          <div className="absolute -bottom-12 left-6 size-28 rounded-full bg-acento-500/30 blur-2xl" />
          <div className="relative flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-xl bg-white/10 font-display text-sm font-bold ring-1 ring-white/15">
              BN
            </span>
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-acento-300">Barbería</p>
              <p className="font-display text-base font-bold leading-tight">Barbería Norte</p>
            </div>
          </div>
        </div>

        <div className="relative -mt-6 rounded-t-3xl bg-white px-3.5 pb-4 pt-4">
          <div className="mb-3 flex gap-1">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={cx("h-1 flex-1 rounded-full", i < 3 ? "bg-marca-600" : "bg-zinc-200")} />
            ))}
          </div>
          <div className="mb-3 rounded-2xl bg-marca-50 px-3 py-2">
            <p className="text-[11px] font-bold text-marca-950">Corte + barba</p>
            <p className="text-[10px] text-marca-900/70">45 min · Con Nico</p>
          </div>
          <p className="font-display text-[13px] font-bold">Elegí día y horario</p>
          <div className="mt-2 flex gap-1.5">
            {DIAS.map((d) => (
              <span
                key={d.n}
                className={cx(
                  "flex w-[2.6rem] flex-col items-center rounded-xl border py-1.5",
                  d.activo
                    ? "border-marca-700 bg-marca-700 text-white"
                    : d.libre
                      ? "border-zinc-200 bg-white"
                      : "border-transparent bg-zinc-100 text-zinc-300",
                )}
              >
                <span className="text-[8px] font-semibold uppercase">{d.d}</span>
                <span className="text-sm font-bold leading-tight">{d.n}</span>
              </span>
            ))}
          </div>
          <p className="mb-1.5 mt-3 text-[9px] font-bold uppercase tracking-wider text-zinc-400">Tarde</p>
          <div className="grid grid-cols-4 gap-1.5">
            {HORARIOS.map((h) => (
              <span
                key={h}
                className={cx(
                  "rounded-lg border py-1.5 text-center text-[10px] font-semibold tabular-nums",
                  h === "17:30" ? "border-acento-500 bg-acento-500 text-white" : "border-zinc-200 bg-white",
                  (h === "16:00" || h === "18:30") && "border-transparent bg-zinc-100 text-zinc-300 line-through",
                )}
              >
                {h}
              </span>
            ))}
          </div>
          <span className="mt-4 flex h-9 items-center justify-center rounded-xl bg-marca-700 text-[11px] font-semibold text-white">
            Continuar
          </span>
        </div>
      </div>
    </div>
  );
}

/** Tarjetita flotante tipo notificación. */
export function Notificacion({
  icono,
  titulo,
  texto,
  className,
  tono = "marca",
}: {
  icono: React.ReactNode;
  titulo: string;
  texto: string;
  className?: string;
  tono?: "marca" | "acento" | "verde";
}) {
  const tonos = {
    marca: "bg-marca-100 text-marca-700",
    acento: "bg-acento-100 text-acento-600",
    verde: "bg-emerald-100 text-emerald-700",
  }[tono];
  return (
    <div
      className={cx(
        "flex w-60 items-center gap-3 rounded-2xl border border-white/60 bg-white/90 p-3 shadow-flotante backdrop-blur-md",
        className,
      )}
      aria-hidden
    >
      <span className={cx("grid size-9 shrink-0 place-items-center rounded-xl", tonos)}>{icono}</span>
      <div className="min-w-0">
        <p className="truncate text-xs font-bold text-tinta">{titulo}</p>
        <p className="truncate text-[11px] text-zinc-500">{texto}</p>
      </div>
    </div>
  );
}

const TURNOS_HOY = [
  { hora: "09:30", cliente: "Martín R.", servicio: "Corte clásico", prof: "Nico", color: "#2f7556" },
  { hora: "10:15", cliente: "Lucas F.", servicio: "Corte + barba", prof: "Santi", color: "#e2622b" },
  { hora: "11:00", cliente: "Tomás G.", servicio: "Perfilado de barba", prof: "Nico", color: "#2f7556" },
  { hora: "12:30", cliente: "Joaquín P.", servicio: "Corte + lavado", prof: "Santi", color: "#e2622b" },
];

/** Vista del panel del negocio: turnos de hoy y números rápidos. */
export function PanelMaqueta({ className }: { className?: string }) {
  return (
    <div
      className={cx("overflow-hidden rounded-3xl border border-zinc-200/80 bg-white shadow-flotante", className)}
      aria-hidden
    >
      <div className="flex items-center gap-1.5 border-b border-zinc-100 bg-zinc-50/80 px-4 py-3">
        <span className="size-2.5 rounded-full bg-zinc-300" />
        <span className="size-2.5 rounded-full bg-zinc-300" />
        <span className="size-2.5 rounded-full bg-zinc-300" />
        <span className="ml-3 truncate rounded-md bg-white px-2.5 py-0.5 text-[11px] text-zinc-400 ring-1 ring-zinc-200">
          agenda2.tech/panel
        </span>
      </div>
      <div className="grid gap-5 p-5 sm:grid-cols-[1fr_11rem]">
        <div>
          <p className="font-display text-lg font-bold">¡Hola, Nico!</p>
          <p className="text-xs text-zinc-500">Martes 15 de diciembre</p>
          <p className="mb-2 mt-4 flex items-center gap-2 text-sm font-bold">
            Hoy <span className="rounded-full bg-marca-100 px-2 py-0.5 text-[11px] text-marca-800">4</span>
          </p>
          <ul className="divide-y divide-zinc-100 rounded-2xl border border-zinc-200/80">
            {TURNOS_HOY.map((t) => (
              <li key={t.hora} className="flex items-center gap-3 px-3 py-2.5">
                <span className="h-8 w-1 rounded-full" style={{ background: t.color }} />
                <span className="w-11 text-sm font-bold tabular-nums">{t.hora}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold">{t.cliente}</span>
                  <span className="block truncate text-[11px] text-zinc-500">
                    {t.servicio} · {t.prof}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-1">
          <Numero valor="38" texto="turnos esta semana" />
          <Numero valor="92%" texto="asistencia" tono="verde" />
          <Numero valor="11" texto="clientes nuevos" tono="acento" />
        </div>
      </div>
    </div>
  );
}

function Numero({ valor, texto, tono = "marca" }: { valor: string; texto: string; tono?: "marca" | "verde" | "acento" }) {
  const color = { marca: "text-marca-700", verde: "text-emerald-600", acento: "text-acento-600" }[tono];
  return (
    <div className="rounded-2xl bg-zinc-50 px-3.5 py-3">
      <p className={cx("font-display text-2xl font-bold tabular-nums", color)}>{valor}</p>
      <p className="text-[11px] text-zinc-500">{texto}</p>
    </div>
  );
}
