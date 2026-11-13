import "server-only";
import { cache } from "react";
import { comoAnonimo, sql } from "@/lib/db";

export type ServicioPublico = {
  id: string;
  nombre: string;
  descripcion: string | null;
  duracion_min: number;
  precio: number | null;
  /** Seña que se cobra al reservar (null = sin seña). */
  sena: number | null;
  profesional_ids: string[] | null;
};

export type NegocioPublico = {
  id: string;
  nombre: string;
  slug: string;
  rubro: string;
  telefono: string | null;
  direccion: string | null;
  descripcion: string | null;
  zona_horaria: string;
  cancelacion_min_horas: number;
  anticipacion_max_dias: number;
  pago_plazo_min: number;
  /** False si la cuenta del negocio está apagada (pasó la gracia) o dada de baja. */
  reservas_habilitadas: boolean;
  servicios: ServicioPublico[];
  profesionales: { id: string; nombre: string }[];
};

export type TurnoPublico = {
  id: string;
  estado: "pendiente" | "confirmado" | "cancelado" | "completado" | "ausente";
  inicio: string;
  fin: string;
  precio: number | null;
  servicio: string;
  profesional: string;
  cliente: string;
  negocio: { nombre: string; slug: string; telefono: string | null; direccion: string | null; zona_horaria: string };
  cancelacion_min_horas: number;
  cancelable_hasta: string;
  cancelado_por: "cliente" | "negocio" | "sistema" | null;
  sena_monto: number | null;
  pago_estado: "pendiente" | "aprobado" | "vencido" | "reembolsar" | "devuelta" | null;
  pago_vence_at: string | null;
  puede_cancelar: boolean;
};

/** Datos públicos del negocio (el rol anónimo no lee tablas: solo esta función). */
export const getNegocioPublico = cache(async (slug: string): Promise<NegocioPublico | null> => {
  if (!/^[a-z0-9-]{3,50}$/.test(slug)) return null;
  try {
    const fila = await comoAnonimo((tx) =>
      tx.uno<{ d: NegocioPublico | null }>(sql`select public.negocio_publico(${slug}) as d`),
    );
    return fila?.d ?? null;
  } catch (e) {
    console.error("[publico] negocio_publico", e);
    return null;
  }
});

export const getTurnoPublico = cache(async (token: string): Promise<TurnoPublico | null> => {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  try {
    const fila = await comoAnonimo((tx) => tx.uno<{ d: TurnoPublico | null }>(sql`select public.ver_turno(${token}) as d`));
    return fila?.d ?? null;
  } catch (e) {
    console.error("[publico] ver_turno", e);
    return null;
  }
});

export { linkWhatsApp } from "@/lib/whatsapp";
