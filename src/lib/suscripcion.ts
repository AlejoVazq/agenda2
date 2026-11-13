// Suscripción de cada negocio (plan mensual, pagos registrados a mano por el admin).
// El estado lo calcula la base (plataforma.estado_suscripcion, migraciones 0002 y 0007)
// con prueba_hasta, pagado_hasta y suspendido_at; acá solo se muestra.
//
// Qué permite cada estado:
//   prueba / activa   todo funciona
//   gracia            5 días desde que vence: panel en solo lectura, la página sigue tomando reservas
//   vencida           apagado: no entra al panel (requerirPanel lo manda a /pausado) y la página no toma reservas
//   suspendida        dado de baja por el admin: igual que vencida
//
// La base rechaza las escrituras del panel fuera de prueba/activa (NEGOCIO_NO_HABILITADO).
// Las acciones que escriben con el rol del servidor (equipo, integraciones, logo) lo
// chequean con `sesion.habilitado`.

export type EstadoSuscripcion = "prueba" | "activa" | "gracia" | "vencida" | "suspendida";

export type Suscripcion = {
  estado: EstadoSuscripcion;
  prueba_hasta: string;
  pagado_hasta: string | null;
  /** Cuándo se apaga (fin de la gracia). Null si está dado de baja. */
  fin_servicio: string | null;
  suspension_motivo: string | null;
};

export const DIAS_PRUEBA = 7;
/** Igual que plataforma.dias_gracia() en la base. */
export const DIAS_GRACIA = 5;
/** Días antes del vencimiento en que sale el mail de aviso (migración 0007). */
export const DIAS_AVISO = { plan: 4, prueba: 2 } as const;

/** El panel se puede usar con normalidad. */
export function estaHabilitado(estado: EstadoSuscripcion) {
  return estado === "prueba" || estado === "activa";
}

/** Apagado: no se entra al panel y la página no toma reservas. */
export function estaApagado(estado: EstadoSuscripcion) {
  return estado === "vencida" || estado === "suspendida";
}

export const MENSAJE_SOLO_LECTURA =
  "Tu suscripción venció: el panel quedó en solo lectura. Renovala para volver a hacer cambios.";

const DIA = 86_400_000;

/** Días que faltan hasta `fecha` (redondeado para arriba; 0 si ya pasó). */
export function diasHasta(fecha: string | null | undefined): number {
  if (!fecha) return 0;
  return Math.max(0, Math.ceil((new Date(fecha).getTime() - Date.now()) / DIA));
}

const sumarDias = (fecha: string, dias: number) => new Date(new Date(fecha).getTime() + dias * DIA).toISOString();

export const ETIQUETA_ESTADO: Record<EstadoSuscripcion, string> = {
  prueba: "En prueba",
  activa: "Activa",
  gracia: "Vencida · solo lectura",
  vencida: "Apagada",
  suspendida: "Dada de baja",
};

/** Qué le pasa al negocio en cada estado (para el admin y el dueño). */
export const EFECTO_ESTADO: Record<EstadoSuscripcion, string> = {
  prueba: "Todo funciona.",
  activa: "Todo funciona.",
  gracia: "El panel está en solo lectura; la página sigue tomando reservas.",
  vencida: "No puede entrar al panel y la página no toma reservas. Los datos quedan guardados.",
  suspendida: "No puede entrar al panel y la página no toma reservas. Los datos quedan guardados.",
};

export type PeriodoPago = { periodo_desde: string; periodo_hasta: string; anulado_at: string | null };

export type Membresia = {
  /** Lo que vence: fin del último pago o de la prueba. */
  vence: string;
  /** El último período es pago (si no, es la prueba). */
  esPlan: boolean;
  /** Cuándo sale el mail de aviso. */
  aviso: string;
  /** Cuándo se apaga si no paga (fin de la gracia). */
  apagado: string;
  /** Período en curso (prueba o pago) y en qué día va, si está dentro de uno. */
  periodo: { tipo: "prueba" | "plan"; desde: string; hasta: string; dia: number; total: number } | null;
};

/** Línea de tiempo de la membresía, con las mismas reglas que la base. */
export function calcularMembresia(d: {
  created_at: string;
  prueba_hasta: string;
  pagado_hasta: string | null;
  pagos?: PeriodoPago[];
}): Membresia {
  const esPlan = Boolean(d.pagado_hasta && new Date(d.pagado_hasta).getTime() > new Date(d.prueba_hasta).getTime());
  const vence = esPlan ? d.pagado_hasta! : d.prueba_hasta;
  const ahora = Date.now();

  const enCurso = (desde: string, hasta: string) => new Date(desde).getTime() <= ahora && ahora < new Date(hasta).getTime();
  const armar = (tipo: "prueba" | "plan", desde: string, hasta: string) => {
    const total = Math.max(1, Math.round((new Date(hasta).getTime() - new Date(desde).getTime()) / DIA));
    const dia = Math.min(total, Math.max(1, Math.floor((ahora - new Date(desde).getTime()) / DIA) + 1));
    return { tipo, desde, hasta, dia, total };
  };

  let periodo: Membresia["periodo"] = null;
  const pago = (d.pagos ?? []).find((p) => !p.anulado_at && enCurso(p.periodo_desde, p.periodo_hasta));
  if (pago) periodo = armar("plan", pago.periodo_desde, pago.periodo_hasta);
  else if (enCurso(d.created_at, d.prueba_hasta)) periodo = armar("prueba", d.created_at, d.prueba_hasta);

  return {
    vence,
    esPlan,
    aviso: sumarDias(vence, -(esPlan ? DIAS_AVISO.plan : DIAS_AVISO.prueba)),
    apagado: sumarDias(vence, DIAS_GRACIA),
    periodo,
  };
}

export type PasoMembresia = { titulo: string; fecha: string; hasta?: string; detalle: string; momento: "pasado" | "ahora" | "futuro" };

/** Las etapas de la membresía en orden, marcando en cuál está hoy. */
export function pasosMembresia(d: {
  created_at: string;
  prueba_hasta: string;
  pagado_hasta: string | null;
  pagos?: PeriodoPago[];
}): PasoMembresia[] {
  const m = calcularMembresia(d);
  const ms = (f: string) => new Date(f).getTime();
  const vigentes = (d.pagos ?? []).filter((p) => !p.anulado_at);
  const inicioPlan = vigentes.length
    ? vigentes.reduce((min, p) => (ms(p.periodo_desde) < ms(min) ? p.periodo_desde : min), vigentes[0].periodo_desde)
    : null;

  const pasos: Omit<PasoMembresia, "momento">[] = [
    { titulo: "Alta y prueba gratis", fecha: d.created_at, hasta: d.prueba_hasta, detalle: "Todo funciona." },
    ...(m.esPlan && inicioPlan ? [{ titulo: "Plan pago", fecha: inicioPlan, hasta: d.pagado_hasta!, detalle: "Todo funciona." }] : []),
    {
      titulo: "Aviso por mail",
      fecha: m.aviso,
      detalle: m.esPlan
        ? `${DIAS_AVISO.plan} días antes de vencer (día 26 de un mes de 30).`
        : `${DIAS_AVISO.prueba} días antes de que termine la prueba.`,
    },
    {
      titulo: "Vence: solo lectura",
      fecha: m.vence,
      hasta: m.apagado,
      detalle: `${DIAS_GRACIA} días de gracia: no puede cambiar nada en el panel, pero su página sigue tomando reservas.`,
    },
    {
      titulo: "Se apaga",
      fecha: m.apagado,
      detalle: "No entra al panel y la página no toma reservas. Los datos quedan guardados; si paga, vuelve todo.",
    },
  ];
  const ahora = Date.now();
  let actual = -1;
  pasos.forEach((p, i) => {
    if (ms(p.fecha) <= ahora) actual = i;
  });
  return pasos.map((p, i) => ({ ...p, momento: i < actual ? "pasado" : i === actual ? "ahora" : "futuro" }));
}
