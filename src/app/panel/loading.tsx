// Esqueleto mientras carga una página del panel (el menú queda visible).
export default function CargandoPanel() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true" aria-label="Cargando">
      <div className="space-y-2">
        <div className="h-7 w-48 rounded-lg bg-zinc-200" />
        <div className="h-4 w-72 max-w-full rounded bg-zinc-100" />
      </div>
      <div className="h-32 rounded-2xl bg-zinc-100" />
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-14 rounded-xl bg-zinc-100" />
        ))}
      </div>
    </div>
  );
}
