import type { ReactNode } from "react";
import Link from "next/link";
import { Logo } from "@/components/ui";

export default function LayoutAuth({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-gradient-to-b from-marca-50 to-fondo">
      <header className="px-4 py-5 sm:px-6">
        <Link href="/" aria-label="Inicio">
          <Logo />
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-4 sm:items-center sm:pt-0">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
