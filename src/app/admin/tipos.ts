import type { EstadoSuscripcion } from "@/lib/suscripcion";

// Lo que devuelven plataforma.admin_negocios() y plataforma.admin_negocio() (migración 0002).

export type FilaNegocioAdmin = {
  id: string;
  nombre: string;
  slug: string;
  rubro: string;
  telefono: string | null;
  created_at: string;
  dueno_nombre: string | null;
  dueno_email: string | null;
  dueno_verificado: boolean | null;
  ultimo_ingreso: string | null;
  estado: EstadoSuscripcion;
  prueba_hasta: string;
  pagado_hasta: string | null;
  fin_servicio: string | null;
  profesionales: number;
  turnos_30d: number;
};

export type PagoAdmin = {
  id: string;
  monto: number;
  medio: MedioPago;
  meses: number;
  periodo_desde: string;
  periodo_hasta: string;
  nota: string | null;
  anulado_at: string | null;
  anulado_motivo: string | null;
  created_at: string;
};

export type NegocioAdmin = {
  id: string;
  nombre: string;
  slug: string;
  rubro: string;
  telefono: string | null;
  direccion: string | null;
  created_at: string;
  estado: EstadoSuscripcion;
  prueba_hasta: string;
  pagado_hasta: string | null;
  fin_servicio: string | null;
  suspendido_at: string | null;
  suspension_motivo: string | null;
  equipo: {
    id: string;
    nombre: string;
    rol: "dueno" | "empleado";
    email: string;
    email_verificado: boolean;
    ultimo_ingreso: string | null;
  }[];
  profesionales: {
    id: string;
    nombre: string;
    activo: boolean;
    tiene_usuario: boolean;
    servicios: number;
    horarios: { dia_semana: number; desde: string; hasta: string }[];
  }[];
  servicios: { nombre: string; duracion_min: number; activo: boolean }[];
  uso: { turnos_30d: number; turnos_futuros: number; online_30d: number; clientes: number };
  pagos: PagoAdmin[];
  notas: { id: string; texto: string; autor: string | null; created_at: string }[];
  auditoria: { accion: string; detalle: Record<string, unknown>; admin: string | null; created_at: string }[];
};

export const MEDIOS_PAGO = {
  transferencia: "Transferencia",
  efectivo: "Efectivo",
  mercadopago: "Mercado Pago",
  otro: "Otro",
} as const;
export type MedioPago = keyof typeof MEDIOS_PAGO;

export const ACCIONES_AUDITORIA: Record<string, string> = {
  registrar_pago: "Registró un pago",
  anular_pago: "Anuló un pago",
  extender_prueba: "Extendió la prueba",
  suspender: "Suspendió el negocio",
  reactivar: "Reactivó el negocio",
  agregar_nota: "Agregó una nota",
  cambiar_slug: "Cambió la dirección",
  link_acceso_dueno: "Generó un link de acceso para el dueño",
  reenviar_verificacion: "Reenvió el mail de verificación",
};
