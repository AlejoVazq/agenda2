import Link from "next/link";
import { BotonLink, Logo } from "@/components/ui";
import { MARCA } from "@/lib/marca";

const BENEFICIOS = [
  {
    titulo: "Reservas 24/7 desde el celular",
    texto: "Tus clientes eligen servicio, profesional y horario en segundos. Sin descargar nada ni crear cuenta.",
  },
  {
    titulo: "Nunca más turnos pisados",
    texto: "Calculamos los horarios libres de cada profesional y bloqueamos el horario apenas alguien reserva.",
  },
  {
    titulo: "Tu equipo, cada uno con su agenda",
    texto: "Vos ves todo el negocio; cada empleado ve y gestiona solo sus propios turnos.",
  },
  {
    titulo: "Cancelaciones con reglas claras",
    texto: "Definí hasta cuántas horas antes se puede cancelar online. Cada cliente tiene su link para ver o cancelar.",
  },
];

export default function Inicio() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Logo />
        <nav className="flex items-center gap-2">
          <Link href="/login" className="rounded-lg px-3 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-100">
            Ingresar
          </Link>
          <BotonLink href="/registro" tamano="sm">
            Empezar gratis
          </BotonLink>
        </nav>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-4 pb-16 pt-10 sm:px-6 sm:pt-20">
          <div className="max-w-2xl">
            <p className="inline-flex rounded-full bg-marca-100 px-3 py-1 text-xs font-bold text-marca-800">
              Para peluquerías masculinas y femeninas, barberías, uñas y estética
            </p>
            <h1 className="mt-5 text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-6xl">
              Tus turnos online, <span className="text-marca-700">sin vueltas</span>.
            </h1>
            <p className="mt-5 text-lg text-zinc-600">{MARCA.descripcion}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <BotonLink href="/registro" tamano="lg">
                Crear mi agenda gratis
              </BotonLink>
            </div>
          </div>
        </section>

        <section className="border-y border-zinc-200 bg-white">
          <div className="mx-auto grid max-w-6xl gap-6 px-4 py-14 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
            {BENEFICIOS.map((b, i) => (
              <div key={b.titulo}>
                <span className="grid size-9 place-items-center rounded-xl bg-marca-100 text-sm font-extrabold text-marca-800">
                  {i + 1}
                </span>
                <h2 className="mt-3 font-bold">{b.titulo}</h2>
                <p className="mt-1 text-sm text-zinc-600">{b.texto}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="mx-auto w-full max-w-6xl px-4 py-8 text-sm text-zinc-500 sm:px-6">
        © {new Date().getFullYear()} {MARCA.nombre} · Hecho en Argentina ·{" "}
        <Link href="/privacidad" className="underline">
          Privacidad
        </Link>{" "}
        ·{" "}
        <Link href="/terminos" className="underline">
          Términos
        </Link>
      </footer>
    </div>
  );
}
