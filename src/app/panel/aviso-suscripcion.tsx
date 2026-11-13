import { Aviso } from "@/components/ui";
import { env } from "@/lib/env";
import { formatFechaLarga } from "@/lib/fechas";
import { MARCA } from "@/lib/marca";
import { DIAS_AVISO, diasHasta, type Suscripcion } from "@/lib/suscripcion";

// Avisa en todo el panel cómo está la suscripción. Al empleado solo le avisa si el
// panel quedó en solo lectura (lo demás es cosa del dueño). Apagada o dada de baja no
// llega acá: requerirPanel manda a /pausado.
export function AvisoSuscripcion({ suscripcion: s, esDueno }: { suscripcion: Suscripcion; esDueno: boolean }) {
  const contacto = env.contactoEmail ? (
    <a className="font-semibold underline" href={`mailto:${env.contactoEmail}?subject=${encodeURIComponent(`Suscripción ${MARCA.nombre}`)}`}>
      {env.contactoEmail}
    </a>
  ) : null;
  const escribinos = contacto ? <> Escribinos a {contacto}.</> : null;

  if (s.estado === "gracia") {
    return (
      <Aviso tipo="error" className="mb-5 space-y-1">
        <p className="font-semibold">Tu suscripción venció: el panel está en solo lectura.</p>
        <p>
          Tu página sigue tomando reservas
          {s.fin_servicio ? <> hasta el {formatFechaLarga(s.fin_servicio)}</> : null}. Si no se renueva, ese día se
          apaga: no se va a poder entrar al panel y la página deja de tomar turnos. Tus datos quedan guardados.
          {esDueno ? escribinos : " Avisale al dueño del negocio."}
        </p>
      </Aviso>
    );
  }

  if (!esDueno) return null;

  if (s.estado === "prueba") {
    const dias = diasHasta(s.prueba_hasta);
    return (
      <Aviso tipo="info" className="mb-5">
        <span className="font-semibold">
          Estás en el período de prueba: {dias <= 1 ? "termina hoy" : `te quedan ${dias} días`}.
        </span>{" "}
        Para seguir usando {MARCA.nombre} después del {formatFechaLarga(s.prueba_hasta)}, contratá el plan mensual.
        {escribinos}
      </Aviso>
    );
  }

  // Activa: avisa desde el día del mail (4 días antes de vencer).
  if (s.estado === "activa" && s.pagado_hasta && diasHasta(s.pagado_hasta) <= DIAS_AVISO.plan) {
    return (
      <Aviso tipo="alerta" className="mb-5">
        Tu plan vence el {formatFechaLarga(s.pagado_hasta)}. Renovalo para seguir usando el panel con normalidad.
        {escribinos}
      </Aviso>
    );
  }

  return null;
}
