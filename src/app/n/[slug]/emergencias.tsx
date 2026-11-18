import { IconoWhatsApp } from "@/components/icono-whatsapp";
import { formatPrecio } from "@/lib/fechas";
import type { ServicioEmergencia } from "@/lib/publico";
import { linkWhatsApp } from "@/lib/whatsapp";

/** Servicios de emergencia: no se reservan, se ve el precio y se escribe por WhatsApp. */
export function Emergencias({ servicios }: { servicios: ServicioEmergencia[] }) {
  if (servicios.length === 0) return null;
  return (
    <section
      aria-labelledby="t-emergencias"
      className="mt-6 rounded-[2rem] bg-white p-5 shadow-suave ring-1 ring-zinc-200/60 sm:p-6"
    >
      <h2 id="t-emergencias" className="font-display text-xl font-bold">
        ¿Necesitás un turno urgente?
      </h2>
      <p className="mt-1 text-sm text-zinc-600">Se coordina por WhatsApp, fuera de los horarios de la agenda.</p>
      <ul className="mt-4 space-y-3">
        {servicios.map((s) => (
          <li key={s.id} className="rounded-2xl border border-zinc-200 p-4">
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-semibold">{s.nombre}</p>
              {s.precio !== null ? <p className="shrink-0 font-semibold text-marca-800">{formatPrecio(s.precio)}</p> : null}
            </div>
            {s.descripcion ? <p className="mt-1 text-sm text-zinc-600">{s.descripcion}</p> : null}
            <a
              href={linkWhatsApp(s.whatsapp, `Hola, quiero pedir un turno de emergencia (${s.nombre})`)}
              target="_blank"
              className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 font-semibold text-white shadow-[0_8px_20px_-8px_rgb(5_150_105/0.6)] transition hover:bg-emerald-700 sm:w-auto"
            >
              <IconoWhatsApp className="size-5" />
              Hablar por WhatsApp
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
