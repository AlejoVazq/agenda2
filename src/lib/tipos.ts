// Tipos de las filas de la base (espejo de supabase/migrations).
// Se pueden reemplazar por los generados con `npm run db:tipos`.

export type Rol = "dueno" | "empleado";
export type EstadoTurno = "pendiente" | "confirmado" | "cancelado" | "completado";

export const RUBROS = {
  peluqueria: "Peluquería",
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
  descripcion: string | null;
  zona_horaria: string;
  cancelacion_min_horas: number;
  anticipacion_min_min: number;
  anticipacion_max_dias: number;
  intervalo_min: number;
  confirmacion_automatica: boolean;
  activo: boolean;
}

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
  cliente_id: string;
  inicio: string;
  fin: string;
  estado: EstadoTurno;
  precio: number | null;
  notas: string | null;
  origen: "online" | "panel";
}

export const DIAS_SEMANA = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"] as const;

export const ESTADOS_TURNO: Record<EstadoTurno, string> = {
  pendiente: "Pendiente",
  confirmado: "Confirmado",
  cancelado: "Cancelado",
  completado: "Completado",
};

/** Resultado estándar de una Server Action usada con useActionState. */
export type EstadoAccion = {
  ok?: boolean;
  mensaje?: string;
  error?: string;
  errores?: Record<string, string[] | undefined>;
};
