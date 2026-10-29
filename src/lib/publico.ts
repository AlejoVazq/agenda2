import "server-only";
import { cache } from "react";
import { crearSupabaseServidor } from "@/lib/supabase/server";

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
  servicios: ServicioPublico[];
  profesionales: { id: string; nombre: string }[];
};

export type TurnoPublico = {
  id: string;
  estado: "pendiente" | "confirmado" | "cancelado" | "completado";
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

/** Datos públicos del negocio vía RPC (el rol anon no lee tablas directamente). */
export const getNegocioPublico = cache(async (slug: string): Promise<NegocioPublico | null> => {
  if (!/^[a-z0-9-]{3,50}$/.test(slug)) return null;
  const supabase = await crearSupabaseServidor();
  const { data, error } = await supabase.rpc("negocio_publico", { p_slug: slug });
  if (error || !data) return null;
  return data as NegocioPublico;
});

export const getTurnoPublico = cache(async (token: string): Promise<TurnoPublico | null> => {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const supabase = await crearSupabaseServidor();
  const { data, error } = await supabase.rpc("ver_turno", { p_token: token });
  if (error || !data) return null;
  return data as TurnoPublico;
});

export { linkWhatsApp } from "@/lib/whatsapp";
