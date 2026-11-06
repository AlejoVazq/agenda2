import type { Metadata } from "next";
import Link from "next/link";
import { MARCA } from "@/lib/marca";

export const metadata: Metadata = { title: "Términos" };

export default function PaginaTerminos() {
  return (
    <main className="mx-auto max-w-2xl space-y-5 px-4 py-10 text-sm leading-relaxed text-zinc-700 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight text-tinta">Términos de uso</h1>
      <p>
        {MARCA.nombre} está en versión preliminar, en etapa de prueba. Puede tener errores, cambiar o interrumpirse, por lo
        que conviene no depender solo de ella para la agenda de un negocio.
      </p>
      <p>
        El servicio contratado con cada turno, su precio y sus condiciones son responsabilidad del negocio que lo ofrece.
        {MARCA.nombre} solo facilita la reserva.
      </p>
      <p>
        Para evitar abusos, los negocios pueden limitar las reservas: un turno por fecha con cada email, hasta 3 turnos
        futuros por local y uno solo a la vez después de 3 inasistencias.
      </p>
      <p>
        El uso de tus datos se explica en la{" "}
        <Link href="/privacidad" className="font-semibold text-marca-700 underline">
          política de privacidad
        </Link>
        .
      </p>
    </main>
  );
}
