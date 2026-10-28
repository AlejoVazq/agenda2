"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { crearSupabaseServidor } from "@/lib/supabase/server";
import { mensajeDeError } from "@/lib/errores";
import { datosDeForm, erroresDeCampo, esquemaConsultaHorarios, esquemaReserva } from "@/lib/validaciones";
import type { EstadoAccion } from "@/lib/tipos";

// Acciones públicas: cualquiera puede llamarlas, así que todo se valida acá
// y además dentro de las funciones SQL (que no confían en la aplicación).

export type Horario = { inicio: string; fin: string };

export async function consultarDias(entrada: {
  negocio_id: string;
  servicio_id: string;
  profesional_id: string | null;
  desde: string;
  dias: number;
}): Promise<string[]> {
  const datos = esquemaConsultaHorarios
    .omit({ fecha: true })
    .extend({ desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), dias: z.number().int().min(1).max(62) })
    .safeParse(entrada);
  if (!datos.success) return [];
  const d = datos.data;

  const supabase = await crearSupabaseServidor();
  const { data } = await supabase.rpc("dias_disponibles", {
    p_negocio_id: d.negocio_id,
    p_servicio_id: d.servicio_id,
    p_desde: d.desde,
    p_dias: d.dias,
    p_profesional_id: d.profesional_id,
  });
  return ((data ?? []) as string[]).map(String);
}

export async function consultarHorarios(entrada: {
  negocio_id: string;
  servicio_id: string;
  profesional_id: string | null;
  fecha: string;
}): Promise<Horario[]> {
  const datos = esquemaConsultaHorarios.safeParse(entrada);
  if (!datos.success) return [];
  const d = datos.data;

  const supabase = await crearSupabaseServidor();
  const { data } = await supabase.rpc("horarios_libres", {
    p_negocio_id: d.negocio_id,
    p_servicio_id: d.servicio_id,
    p_fecha: d.fecha,
    p_profesional_id: d.profesional_id,
  });

  // Con "cualquier profesional" puede haber varios en el mismo horario: se ofrece una vez.
  const vistos = new Set<string>();
  const horarios: Horario[] = [];
  for (const h of (data ?? []) as { inicio: string; fin: string }[]) {
    const clave = new Date(h.inicio).toISOString();
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    horarios.push({ inicio: clave, fin: new Date(h.fin).toISOString() });
  }
  return horarios;
}

export async function reservar(_prev: EstadoAccion, formData: FormData): Promise<EstadoAccion> {
  const datos = esquemaReserva.safeParse(datosDeForm(formData));
  if (!datos.success) return { errores: erroresDeCampo(datos.error) };
  const d = datos.data;

  const supabase = await crearSupabaseServidor();
  const { data, error } = await supabase.rpc("crear_reserva", {
    p_negocio_id: d.negocio_id,
    p_servicio_id: d.servicio_id,
    p_profesional_id: d.profesional_id,
    p_inicio: d.inicio,
    p_nombre: d.nombre,
    p_telefono: d.telefono,
    p_email: d.email,
  });

  const fila = (data as { turno_id: string; token: string }[] | null)?.[0];
  if (error || !fila) return { error: mensajeDeError(error, "No pudimos tomar la reserva. Probá de nuevo.") };

  redirect(`/t/${fila.token}?nueva=1`);
}
