import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { MARCA } from "@/lib/marca";

export function cx(...clases: (string | false | null | undefined)[]) {
  return clases.filter(Boolean).join(" ");
}

// --- Botones -------------------------------------------------------------------------

type Variante = "primario" | "secundario" | "fantasma" | "peligro";
type Tamano = "sm" | "md" | "lg";

const VARIANTES: Record<Variante, string> = {
  primario: "bg-marca-700 text-white hover:bg-marca-800 active:bg-marca-900 shadow-sm shadow-marca-900/10",
  secundario: "bg-white text-tinta border border-zinc-200 hover:border-marca-300 hover:bg-marca-50",
  fantasma: "text-marca-700 hover:bg-marca-50",
  peligro: "bg-white text-red-700 border border-red-200 hover:bg-red-50",
};

const TAMANOS: Record<Tamano, string> = {
  sm: "h-9 px-3 text-sm rounded-lg",
  md: "h-11 px-4 text-sm rounded-xl",
  lg: "h-12 px-6 text-base rounded-xl",
};

export function clasesBoton(variante: Variante = "primario", tamano: Tamano = "md", extra?: string) {
  return cx(
    "inline-flex items-center justify-center gap-2 font-semibold transition-colors select-none",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca-500",
    "disabled:cursor-not-allowed disabled:opacity-50",
    VARIANTES[variante],
    TAMANOS[tamano],
    extra,
  );
}

export function Boton({
  variante,
  tamano,
  className,
  ...props
}: ComponentProps<"button"> & { variante?: Variante; tamano?: Tamano }) {
  return <button className={clasesBoton(variante, tamano, className)} {...props} />;
}

export function BotonLink({
  variante,
  tamano,
  className,
  ...props
}: ComponentProps<typeof Link> & { variante?: Variante; tamano?: Tamano }) {
  return <Link className={clasesBoton(variante, tamano, className)} {...props} />;
}

// --- Formularios ------------------------------------------------------------------------

const claseInput = cx(
  "block w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-base sm:text-sm text-tinta",
  "placeholder:text-zinc-400 transition-colors",
  "focus:border-marca-500 focus:outline-none focus:ring-4 focus:ring-marca-100",
  "disabled:bg-zinc-50 disabled:text-zinc-500",
  "aria-[invalid=true]:border-red-400 aria-[invalid=true]:focus:ring-red-100",
);

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cx(claseInput, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cx(claseInput, "min-h-24", className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cx(claseInput, "appearance-auto pr-8", className)} {...props} />;
}

export function Campo({
  etiqueta,
  htmlFor,
  ayuda,
  errores,
  children,
  className,
}: {
  etiqueta: ReactNode;
  htmlFor?: string;
  ayuda?: ReactNode;
  errores?: string[];
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-zinc-700">
        {etiqueta}
      </label>
      {children}
      {errores?.length ? (
        <p className="text-sm text-red-600" role="alert">
          {errores[0]}
        </p>
      ) : ayuda ? (
        <p className="text-xs text-zinc-500">{ayuda}</p>
      ) : null}
    </div>
  );
}

export function Casilla({
  etiqueta,
  descripcion,
  ...props
}: ComponentProps<"input"> & { etiqueta: ReactNode; descripcion?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-zinc-200 bg-white p-3.5 has-[:checked]:border-marca-300 has-[:checked]:bg-marca-50/60">
      <input
        type="checkbox"
        className="mt-0.5 size-5 shrink-0 rounded-md border-zinc-300 accent-marca-700"
        {...props}
      />
      <span>
        <span className="block text-sm font-medium text-tinta">{etiqueta}</span>
        {descripcion ? <span className="mt-0.5 block text-xs text-zinc-500">{descripcion}</span> : null}
      </span>
    </label>
  );
}

// --- Contenedores y feedback --------------------------------------------------------------

export function Tarjeta({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("rounded-2xl border border-zinc-200/80 bg-white p-4 sm:p-6", className)} {...props} />;
}

export function Aviso({
  tipo = "info",
  children,
  className,
}: {
  tipo?: "info" | "exito" | "error" | "alerta";
  children: ReactNode;
  className?: string;
}) {
  const estilos = {
    info: "bg-marca-50 text-marca-900 border-marca-100",
    exito: "bg-emerald-50 text-emerald-900 border-emerald-100",
    error: "bg-red-50 text-red-800 border-red-100",
    alerta: "bg-amber-50 text-amber-900 border-amber-100",
  }[tipo];
  return (
    <div role={tipo === "error" ? "alert" : "status"} className={cx("rounded-xl border px-4 py-3 text-sm", estilos, className)}>
      {children}
    </div>
  );
}

export function Insignia({
  color = "gris",
  children,
}: {
  color?: "gris" | "verde" | "violeta" | "ambar" | "rojo";
  children: ReactNode;
}) {
  const estilos = {
    gris: "bg-zinc-100 text-zinc-700",
    verde: "bg-emerald-100 text-emerald-800",
    violeta: "bg-marca-100 text-marca-800",
    ambar: "bg-amber-100 text-amber-800",
    rojo: "bg-red-100 text-red-700",
  }[color];
  return <span className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", estilos)}>{children}</span>;
}

export function EncabezadoPagina({
  titulo,
  descripcion,
  acciones,
  volver,
}: {
  titulo: ReactNode;
  descripcion?: ReactNode;
  acciones?: ReactNode;
  volver?: { href: string; texto: string };
}) {
  return (
    <div className="mb-6">
      {volver ? (
        <Link href={volver.href} className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-marca-700 hover:underline">
          ← {volver.texto}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-tinta">{titulo}</h1>
          {descripcion ? <p className="mt-1 text-sm text-zinc-600">{descripcion}</p> : null}
        </div>
        {acciones ? <div className="flex flex-wrap gap-2">{acciones}</div> : null}
      </div>
    </div>
  );
}

export function Vacio({ titulo, descripcion, accion }: { titulo: string; descripcion?: string; accion?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-300 bg-white/60 px-6 py-10 text-center">
      <p className="font-semibold text-tinta">{titulo}</p>
      {descripcion ? <p className="mx-auto mt-1 max-w-sm text-sm text-zinc-600">{descripcion}</p> : null}
      {accion ? <div className="mt-4">{accion}</div> : null}
    </div>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2 font-extrabold tracking-tight text-tinta", className)}>
      <span className="grid size-8 place-items-center rounded-xl bg-gradient-to-br from-marca-600 to-coral-500 text-white">
        <svg viewBox="0 0 24 24" fill="none" className="size-4.5" aria-hidden>
          <rect x="4" y="5" width="16" height="15" rx="3" stroke="currentColor" strokeWidth="2" />
          <path d="M8 3v4M16 3v4M4 10h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="m9.5 14.5 2 2 3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="text-lg">{MARCA.nombre}</span>
    </span>
  );
}
