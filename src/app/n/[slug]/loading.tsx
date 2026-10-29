export default function CargandoNegocio() {
  return (
    <div className="min-h-dvh bg-fondo" aria-busy="true" aria-label="Cargando">
      <div className="h-40 animate-pulse bg-gradient-to-b from-marca-100 to-fondo" />
      <div className="mx-auto -mt-10 max-w-xl animate-pulse space-y-3 px-4">
        <div className="h-8 w-56 rounded-lg bg-zinc-200" />
        <div className="h-4 w-40 rounded bg-zinc-100" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 rounded-2xl bg-white shadow-sm" />
        ))}
      </div>
    </div>
  );
}
