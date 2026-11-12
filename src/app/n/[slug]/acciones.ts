"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { trasReservaFirme } from "@/lib/eventos";
import { sincronizarGoogleDespues } from "@/lib/google";
import { dentroDelLimite } from "@/lib/limites";
import { crearPagoSena } from "@/lib/mercadopago";
import { comoAnonimo, comoServidor, sql } from "@/lib/db";
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
  if (!(await dentroDelLimite("consultar", 240, 600))) return [];

  const filas = await comoAnonimo((tx) =>
    tx.varios<{ dia: string }>(sql`
      select public.dias_disponibles(${d.negocio_id}, ${d.servicio_id}, ${d.desde}::date, ${d.dias}, ${d.profesional_id}::uuid) as dia`),
  ).catch((e) => {
    console.error("[reserva] dias_disponibles", e);
    return [];
  });
  return filas.map((f) => String(f.dia));
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
  if (!(await dentroDelLimite("consultar", 240, 600))) return [];

  const libres = await comoAnonimo((tx) =>
    tx.varios<{ inicio: string; fin: string }>(sql`
      select inicio, fin from public.horarios_libres(${d.negocio_id}, ${d.servicio_id}, ${d.fecha}::date, ${d.profesional_id}::uuid)`),
  ).catch((e) => {
    console.error("[reserva] horarios_libres", e);
    return [];
  });

  // Con "cualquier profesional" puede haber varios en el mismo horario: se ofrece una vez.
  const vistos = new Set<string>();
  const horarios: Horario[] = [];
  for (const h of libres) {
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

  if (!(await dentroDelLimite(`reservar:${d.negocio_id}`, 20, 3600))) {
    return { error: "Hiciste muchas reservas seguidas. Esperá un rato o comunicate con el negocio." };
  }

  // crear_reserva no está abierta al público, para que este límite no se pueda esquivar.
  let fila: { turno_id: string; token: string; sena: number | null } | null;
  try {
    fila = await comoServidor((tx) =>
      tx.uno<{ turno_id: string; token: string; sena: number | null }>(sql`
        select turno_id, token, sena from public.crear_reserva(
          ${d.negocio_id}, ${d.servicio_id}, ${d.profesional_id ?? null}::uuid, ${d.inicio}::timestamptz,
          ${d.nombre}, ${d.telefono}, ${d.email}
        )`),
    );
  } catch (e) {
    // Al cliente no le corresponde el detalle de la suscripción del negocio.
    if (e instanceof Error && e.message.includes("NEGOCIO_NO_HABILITADO")) {
      return { error: "Este negocio no está tomando reservas online en este momento. Comunicate con el negocio." };
    }
    return { error: mensajeDeError(e, "No pudimos tomar la reserva. Probá de nuevo.") };
  }
  if (!fila) return { error: "No pudimos tomar la reserva. Probá de nuevo." };

  if (Number(fila.sena) > 0) {
    // Turno retenido hasta que se pague la seña: los avisos salen al confirmarse el pago.
    sincronizarGoogleDespues(fila.turno_id);
    const urlPago = await crearPagoSena(fila.turno_id).catch((e) => {
      console.error("[reserva] no se pudo crear el pago", e);
      return null;
    });
    // Si Mercado Pago no respondió, la página del turno ofrece reintentar el pago.
    redirect(urlPago ?? `/t/${fila.token}?nueva=1`);
  }

  trasReservaFirme(fila.turno_id);
  redirect(`/t/${fila.token}?nueva=1`);
}
