import { cx } from "@/components/ui";

const ESTRELLA = "M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z";

/** Cinco estrellas con relleno parcial (p. ej. 4,6 llena 4 y 3/5 de la quinta). */
export function Estrellas({ valor, className, etiqueta }: { valor: number; className?: string; etiqueta?: string }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-px"
      role="img"
      aria-label={etiqueta ?? `${valor.toFixed(1).replace(".", ",")} de 5 estrellas`}
    >
      {[0, 1, 2, 3, 4].map((i) => {
        const relleno = Math.max(0, Math.min(1, valor - i));
        return (
          <span key={i} className={cx("relative inline-block size-4", className)} aria-hidden>
            <svg viewBox="0 0 24 24" className="absolute inset-0 size-full text-zinc-200">
              <path d={ESTRELLA} fill="currentColor" />
            </svg>
            <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${relleno * 100}%` }}>
              <svg viewBox="0 0 24 24" className={cx("size-4 max-w-none text-amber-400", className)}>
                <path d={ESTRELLA} fill="currentColor" />
              </svg>
            </span>
          </span>
        );
      })}
    </span>
  );
}
