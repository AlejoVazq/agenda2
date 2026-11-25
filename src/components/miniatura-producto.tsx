import { cx } from "@/components/ui";

/** Foto de un producto o, si no tiene, su inicial sobre fondo arena (panel y portal). */
export function MiniaturaProducto({
  nombre,
  url,
  className = "size-14 rounded-xl",
}: {
  nombre: string;
  url: string | null;
  className?: string;
}) {
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- imagen propia, ya chica (≤512 px)
      <img src={url} alt={nombre} loading="lazy" className={cx("shrink-0 bg-arena/30 object-cover ring-1 ring-zinc-200", className)} />
    );
  }
  return (
    <span
      className={cx("grid shrink-0 place-items-center bg-arena/40 font-display text-xl font-bold text-tinta/60", className)}
      aria-hidden
    >
      {nombre.trim().slice(0, 1).toUpperCase()}
    </span>
  );
}
