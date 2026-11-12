import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { Logo } from "@/components/ui";
import { cerrarSesion } from "@/app/(auth)/acciones";
import { requerirAdmin } from "@/lib/admin";

// Sin título propio: a quien no es admin se le muestra un 404 común, y el título
// de la pestaña no tiene que delatar que la página existe.
export const metadata: Metadata = { robots: { index: false, follow: false } };

// Panel de la plataforma. Quien no es admin recibe 404 (ver src/lib/admin.ts).
// Cada página vuelve a exigir el segundo factor; acá solo se pide ser admin
// para poder mostrar /admin/seguridad mientras se configura.
export default async function LayoutAdmin({ children }: { children: ReactNode }) {
  await requerirAdmin({ sinDosFactores: true });
  return (
    <div className="min-h-dvh bg-fondo">
      <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/admin" className="shrink-0">
              <Logo />
            </Link>
            <span className="rounded-md bg-tinta px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white">Admin</span>
          </div>
          <nav className="flex items-center gap-1 text-sm font-medium">
            <Link href="/admin" className="rounded-lg px-2.5 py-1.5 text-zinc-700 hover:bg-zinc-100">
              Negocios
            </Link>
            <Link href="/admin/seguridad" className="rounded-lg px-2.5 py-1.5 text-zinc-700 hover:bg-zinc-100">
              Seguridad
            </Link>
            <form action={cerrarSesion}>
              <button className="rounded-lg px-2.5 py-1.5 text-zinc-600 hover:bg-zinc-100">
                Salir
              </button>
            </form>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6 lg:pt-8">{children}</main>
    </div>
  );
}
