import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Tarjeta } from "@/components/ui";
import { cerrarSesion } from "../acciones";
import { getSesion, getSesionPanel } from "@/lib/auth";
import { env } from "@/lib/env";
import { formatFechaLarga } from "@/lib/fechas";
import { MARCA } from "@/lib/marca";
import { estaApagado } from "@/lib/suscripcion";

export const metadata: Metadata = { title: "Cuenta pausada", robots: { index: false } };

// Adonde va el panel cuando la suscripción está apagada (vencida después de la gracia o
// dada de baja): no se entra al panel, pero los datos quedan guardados.
export default async function PaginaPausado() {
  if (!(await getSesion())) redirect("/login");
  const panel = await getSesionPanel();
  if (!panel || !estaApagado(panel.suscripcion.estado)) redirect("/panel");
  const { suscripcion: s, negocio, esDueno } = panel;

  const asunto = encodeURIComponent(`Renovar ${MARCA.nombre}: ${negocio.nombre}`);
  return (
    <Tarjeta className="shadow-xl shadow-marca-900/5">
      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-acento-700">{negocio.nombre}</p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight">
        {s.estado === "suspendida" ? "Tu cuenta está dada de baja" : "Tu suscripción se apagó"}
      </h1>
      <div className="mt-3 space-y-3 text-sm text-zinc-700">
        {s.estado === "suspendida" ? (
          s.suspension_motivo ? <p>Motivo: {s.suspension_motivo}.</p> : null
        ) : s.fin_servicio ? (
          <p>El plan no se renovó y el período de gracia terminó el {formatFechaLarga(s.fin_servicio)}.</p>
        ) : null}
        <p>
          Mientras tanto no se puede entrar al panel y tu página no toma reservas nuevas. Los turnos que ya estaban
          reservados siguen en pie y <span className="font-semibold">todos tus datos quedan guardados</span>: apenas se
          renueva, vuelve todo como estaba.
        </p>
        <p>
          {esDueno ? (
            env.contactoEmail ? (
              <>
                Para renovarla escribinos a{" "}
                <a className="font-semibold text-marca-700 underline" href={`mailto:${env.contactoEmail}?subject=${asunto}`}>
                  {env.contactoEmail}
                </a>
                .
              </>
            ) : (
              "Para renovarla, comunicate con nosotros."
            )
          ) : (
            "Avisale al dueño del negocio para que la renueve."
          )}
        </p>
      </div>
      <form action={cerrarSesion} className="mt-6 border-t border-zinc-100 pt-5">
        <button className="text-sm font-medium text-zinc-600 hover:text-tinta hover:underline">Cerrar sesión</button>
      </form>
    </Tarjeta>
  );
}
