import type { Metadata } from "next";
import { env } from "@/lib/env";
import { MARCA } from "@/lib/marca";

export const metadata: Metadata = { title: "Privacidad" };

export default function PaginaPrivacidad() {
  return (
    <main className="mx-auto max-w-2xl space-y-5 px-4 py-10 text-sm leading-relaxed text-zinc-700 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight text-tinta">Política de privacidad</h1>
      <p>
        {MARCA.nombre} es una herramienta para que los negocios tomen turnos online. Esta versión es preliminar y puede
        cambiar.
      </p>

      <h2 className="font-bold text-tinta">Qué datos guardamos</h2>
      <p>
        Al reservar: tu nombre, celular, email y los turnos que pediste, incluido si asististe o no. Si tenés un negocio:
        tu email, los datos de tu negocio y los de tu agenda.
      </p>

      <h2 className="font-bold text-tinta">Para qué los usamos</h2>
      <p>
        Para gestionar tu turno, enviarte la confirmación y los recordatorios, y aplicar los límites de reserva del
        negocio. Darlos es voluntario, pero sin ellos no se puede reservar online.
      </p>

      <h2 className="font-bold text-tinta">Quién accede</h2>
      <p>
        El negocio donde reservaste y su equipo. También los proveedores que hacen funcionar el servicio (alojamiento, base
        de datos y envío de mails), cuyos servidores pueden estar fuera de Argentina. No vendemos tus datos.
      </p>

      <h2 className="font-bold text-tinta">Tus derechos</h2>
      <p>
        Podés pedir ver, corregir o borrar tus datos
        {env.contactoEmail ? (
          <>
            {" "}
            escribiendo a{" "}
            <a href={`mailto:${env.contactoEmail}`} className="font-semibold text-marca-700 underline">
              {env.contactoEmail}
            </a>
          </>
        ) : (
          " comunicándote con el negocio donde reservaste"
        )}
        . La Ley 25.326 protege estos derechos, y la Agencia de Acceso a la Información Pública es el organismo de control
        que atiende los reclamos.
      </p>
    </main>
  );
}
