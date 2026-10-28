import "server-only";
import { cache } from "react";
import { crearSupabaseServidor } from "@/lib/supabase/server";

export type ServicioPublico = {
  id: string;
  nombre: string;
  descripcion: string | null;
  duracion_min: number;
  precio: number | null;
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

/** Link de WhatsApp a un teléfono argentino (agrega 549 si falta). */
export function linkWhatsApp(telefono: string, texto?: string) {
  let n = telefono.replace(/\D/g, "");
  if (n.startsWith("0")) n = n.slice(1);
  if (!n.startsWith("54")) n = `549${n}`;
  return `https://wa.me/${n}${texto ? `?text=${encodeURIComponent(texto)}` : ""}`;
}
