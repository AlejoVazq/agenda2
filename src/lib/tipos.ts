// Tipos de las filas de la base (espejo de db/migraciones).
// Se pueden reemplazar por los generados con `npm run db:tipos`.

export type Rol = "dueno" | "empleado";
export type EstadoTurno = "pendiente" | "confirmado" | "cancelado" | "completado" | "ausente";

export const RUBROS = {
  peluqueria_masculina: "Peluquería masculina",
  peluqueria_femenina: "Peluquería femenina",
  barberia: "Barbería",
  unas: "Uñas",
  estetica: "Estética",
  spa: "Spa / masajes",
  otro: "Otro",
} as const;
export type Rubro = keyof typeof RUBROS;

export interface Negocio {
  id: string;
  nombre: string;
  slug: string;
  rubro: Rubro;
  telefono: string | null;
  direccion: string | null;
  /** Usuario de Instagram sin @. */
  instagram: string | null;
  descripcion: string | null;
  zona_horaria: string;
  cancelacion_min_horas: number;
  anticipacion_min_min: number;
  anticipacion_max_dias: number;
  intervalo_min: number;
  confirmacion_automatica: boolean;
  recordatorio_horas: number;
  sena_tipo: "ninguna" | "porcentaje" | "fijo";
  sena_valor: number;
  pago_plazo_min: number;
  whatsapp_avisos: boolean;
  /** Color de la página de reservas (#rrggbb); null = el verde de la marca. */
  color: string | null;
  activo: boolean;
  /** Tienda de productos (migración 0020). */
  tienda_activa: boolean;
  tienda_medios: MedioPago[];
  transferencia_alias: string | null;
  /** 22 dígitos. */
  transferencia_cbu: string | null;
  transferencia_titular: string | null;
  /** Plazo para pagar por transferencia (1 a 168 horas). */
  transferencia_plazo_horas: number;
  /** Plazo para pagar y retirar en efectivo (1 a 14 días). */
  efectivo_plazo_dias: number;
}

// --- Productos y pedidos (migraciones 0020 y 0021) ---------------------------------------

export interface Producto {
  id: string;
  negocio_id: string;
  nombre: string;
  descripcion: string | null;
  precio: number;
  /** Disponible (lo apartado por pedidos pendientes o pagados ya está descontado). */
  stock: number;
  activo: boolean;
  orden: number;
}

export type MedioPago = "mercadopago" | "transferencia" | "efectivo";

export const MEDIOS_PEDIDO: Record<MedioPago, string> = {
  mercadopago: "Mercado Pago",
  transferencia: "Transferencia",
  efectivo: "Efectivo en el local",
};

export type EstadoPedido = "pendiente" | "pagado" | "entregado" | "cancelado" | "vencido" | "reembolsar";

export const ESTADOS_PEDIDO: Record<EstadoPedido, string> = {
  pendiente: "Sin pagar",
  pagado: "Pagado",
  entregado: "Entregado",
  cancelado: "Cancelado",
  vencido: "Vencido",
  reembolsar: "A devolver",
};

export interface Perfil {
  id: string;
  negocio_id: string;
  rol: Rol;
  nombre: string;
  profesional_id: string | null;
}

export interface Profesional {
  id: string;
  negocio_id: string;
  nombre: string;
  email: string | null;
  color: string;
  activo: boolean;
  orden: number;
}

export interface Servicio {
  id: string;
  negocio_id: string;
  nombre: string;
  descripcion: string | null;
  duracion_min: number;
  precio: number | null;
  activo: boolean;
  orden: number;
  /** No se reserva en el calendario: el portal muestra el precio y un link de WhatsApp. */
  emergencia: boolean;
  /** Número normalizado; null = teléfono del negocio. */
  contacto_whatsapp: string | null;
}

export interface Horario {
  id: string;
  profesional_id: string;
  dia_semana: number;
  desde: string; // "HH:MM:SS"
  hasta: string;
}

export interface Bloqueo {
  id: string;
  profesional_id: string;
  inicio: string;
  fin: string;
  motivo: string | null;
  origen: "manual" | "google";
}

export interface Cliente {
  id: string;
  nombre: string;
  telefono: string;
  email: string | null;
  notas: string | null;
}

export interface Turno {
  id: string;
  negocio_id: string;
  profesional_id: string;
  servicio_id: string;
  /** Null si se borró la ficha del cliente (el turno queda en el historial). */
  cliente_id: string | null;
  inicio: string;
  fin: string;
  estado: EstadoTurno;
  precio: number | null;
  notas: string | null;
  origen: "online" | "panel";
  sena_monto: number | null;
  pago_estado: EstadoPago | null;
}

export type EstadoPago = "pendiente" | "aprobado" | "vencido" | "reembolsar" | "devuelta";

export const ESTADOS_PAGO: Record<EstadoPago, string> = {
  pendiente: "Seña pendiente",
  aprobado: "Seña pagada",
  vencido: "Seña vencida",
  reembolsar: "Seña a devolver",
  devuelta: "Seña devuelta",
};

export const DIAS_SEMANA = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"] as const;

export const ESTADOS_TURNO: Record<EstadoTurno, string> = {
  pendiente: "Pendiente",
  confirmado: "Confirmado",
  cancelado: "Cancelado",
  completado: "Completado",
  ausente: "No asistió",
};

/** Resultado estándar de una Server Action usada con useActionState. */
export type EstadoAccion = {
  ok?: boolean;
  mensaje?: string;
  error?: string;
  errores?: Record<string, string[] | undefined>;
};
