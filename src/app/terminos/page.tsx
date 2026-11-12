import type { Metadata } from "next";
import Link from "next/link";
import { MARCA } from "@/lib/marca";

export const metadata: Metadata = { title: "Términos" };

export default function PaginaTerminos() {
  return (
    <main className="mx-auto max-w-2xl space-y-5 px-4 py-10 text-sm leading-relaxed text-zinc-700 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight text-tinta">Términos de uso</h1>
      <p className="text-xs text-zinc-500">Última actualización: 12 de noviembre de 2026.</p>
      <h2 className="font-bold text-tinta">El servicio</h2>
      <p>
        {MARCA.nombre} es una herramienta para que negocios de servicios (peluquerías, barberías, uñas, estética) tomen y
        organicen turnos online. Hacemos lo posible para que funcione siempre, pero puede tener errores o interrupciones,
        por lo que conviene no depender solo de ella para la agenda de un negocio.
      </p>
      <h2 className="font-bold text-tinta">Para los negocios: prueba y plan</h2>
      <p>
        Cada negocio nuevo tiene 7 días de prueba sin cargo. Después, para seguir usándolo hay que contratar el plan
        mensual. Si el plan vence, hay 5 días de gracia en los que todo sigue funcionando; pasado ese plazo el panel queda
        en solo lectura y la página deja de tomar reservas nuevas, hasta que se renueve. Los turnos ya reservados se
        mantienen. Podemos suspender una cuenta por falta de pago o por uso indebido.
      </p>
      <h2 className="font-bold text-tinta">Reservas</h2>
      <p>
        El servicio contratado con cada turno, su precio y sus condiciones son responsabilidad del negocio que lo ofrece.
        {MARCA.nombre} solo facilita la reserva.
      </p>
      <p>
        Para evitar abusos, los negocios pueden limitar las reservas: un turno por fecha con cada email, hasta 3 turnos
        futuros por local y uno solo a la vez después de 3 inasistencias.
      </p>
      <h2 className="font-bold text-tinta">Servicios de terceros</h2>
      <p>
        Algunas funciones son opcionales y usan servicios de otras empresas, como Google Calendar para sincronizar la
        agenda o WhatsApp para avisos. Al conectarlas, también se aplican las condiciones de esos servicios, y se pueden
        desconectar en cualquier momento.
      </p>
      <h2 className="font-bold text-tinta">Datos personales</h2>
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
