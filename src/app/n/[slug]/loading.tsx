export default function CargandoNegocio() {
  return (
    <div className="min-h-dvh bg-fondo" aria-busy="true" aria-label="Cargando">
      <div className="bg-noche bg-[radial-gradient(ellipse_70%_90%_at_100%_0%,rgb(106_67_246/0.45),transparent)]">
        <div className="mx-auto flex max-w-xl animate-pulse items-center gap-4 px-4 pb-20 pt-8 sm:pt-12">
          <div className="size-16 rounded-2xl bg-white/10" />
          <div className="space-y-2">
            <div className="h-3 w-24 rounded bg-white/10" />
            <div className="h-7 w-52 rounded-lg bg-white/15" />
          </div>
        </div>
      </div>
      <div className="mx-auto -mt-10 max-w-xl px-4">
        <div className="animate-pulse space-y-3 rounded-[2rem] bg-white p-4 shadow-flotante sm:p-6">
          <div className="h-1.5 rounded-full bg-zinc-100" />
          <div className="h-6 w-44 rounded-lg bg-zinc-200" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 rounded-2xl bg-zinc-100" />
          ))}
        </div>
      </div>
    </div>
  );
}
