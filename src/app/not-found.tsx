import { BotonLink, Logo } from "@/components/ui";

export default function NoEncontrado() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <Logo />
      <h1 className="mt-8 text-2xl font-bold">No encontramos esta página</h1>
      <p className="mt-2 max-w-sm text-sm text-zinc-600">
        Puede que el link esté mal escrito o que ya no exista. Si buscabas un negocio, pedile su link de reservas.
      </p>
      <BotonLink href="/" className="mt-6" variante="secundario">
        Ir al inicio
      </BotonLink>
    </main>
  );
}
