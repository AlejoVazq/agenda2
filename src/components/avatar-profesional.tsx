import { cx } from "@/components/ui";

/** Foto del profesional (solo en el panel) o su inicial sobre su color. */
export function AvatarProfesional({
  nombre,
  color,
  foto,
  className,
}: {
  nombre: string;
  color: string;
  foto: string | null;
  className?: string;
}) {
  if (foto) {
    // eslint-disable-next-line @next/next/no-img-element -- imagen propia, ya chica (≤512 px) y privada del panel
    return <img src={foto} alt="" className={cx("size-10 shrink-0 rounded-full object-cover", className)} />;
  }
  return (
    <span
      className={cx("grid size-10 shrink-0 place-items-center rounded-full text-sm font-bold text-white", className)}
      style={{ background: color }}
      aria-hidden
    >
      {nombre.slice(0, 1).toUpperCase()}
    </span>
  );
}
