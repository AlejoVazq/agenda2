import { Aviso } from "@/components/ui";
import { env } from "@/lib/env";
import { formatFechaLarga } from "@/lib/fechas";
import { MARCA } from "@/lib/marca";
import { diasHasta, type Suscripcion } from "@/lib/suscripcion";

// Avisa en todo el panel cómo está la suscripción. Al empleado solo le avisa si el
// panel quedó en solo lectura (lo demás es cosa del dueño).
export function AvisoSuscripcion({ suscripcion: s, esDueno }: { suscripcion: Suscripcion; esDueno: boolean }) {
  const contacto = env.contactoEmail ? (
    <a className="font-semibold underline" href={`mailto:${env.contactoEmail}?subject=${encodeURIComponent(`Suscripción ${MARCA.nombre}`)}`}>
      {env.contactoEmail}
    </a>
  ) : null;
  const escribinos = contacto ? <> Escribinos a {contacto}.</> : null;

  if (s.estado === "suspendida" || s.estado === "vencida") {
    return (
      <Aviso tipo="error" className="mb-5 space-y-1">
        <p className="font-semibold">
          {s.estado === "suspendida" ? "Tu cuenta está suspendida." : "Tu suscripción venció."}
          {s.estado === "suspendida" && s.suspension_motivo ? ` Motivo: ${s.suspension_motivo}.` : null}
        </p>
        <p>
          El panel quedó en solo lectura y tu página no toma reservas nuevas. Los turnos que ya estaban reservados
          siguen en pie.
          {esDueno ? <> Para renovarla, {contacto ? <>escribinos a {contacto}</> : "comunicate con nosotros"}.</> : " Avisale al dueño del negocio."}
        </p>
      </Aviso>
    );
  }

  if (!esDueno) return null;

  if (s.estado === "gracia" && s.fin_servicio) {
    return (
      <Aviso tipo="alerta" className="mb-5">
        <span className="font-semibold">Tu suscripción venció.</span> Todo sigue funcionando hasta el{" "}
        {formatFechaLarga(s.fin_servicio)}; después el panel queda en solo lectura y tu página deja de tomar
        reservas.{escribinos}
      </Aviso>
    );
  }

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

  // Activa: solo avisa en los últimos días.
  if (s.estado === "activa" && s.pagado_hasta && diasHasta(s.pagado_hasta) <= 5) {
    return (
      <Aviso tipo="alerta" className="mb-5">
        Tu plan vence el {formatFechaLarga(s.pagado_hasta)}. Renovalo para que tu página siga tomando reservas.
        {escribinos}
      </Aviso>
    );
  }

  return null;
}
