"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sesionParaAccion } from "@/lib/auth";
import { comoUsuario, esErrorPg, sql } from "@/lib/db";
import { mensajeDeError } from "@/lib/errores";
import { datosDeForm, erroresDeCampo, esquemaCliente } from "@/lib/validaciones";
import type { EstadoAccion } from "@/lib/tipos";

export async function guardarCliente(id: string, _prev: EstadoAccion, formData: FormData): Promise<EstadoAccion> {
  const sesion = await sesionParaAccion({ soloDueno: true });
  if (!sesion) return { error: "Solo el dueño puede editar clientes." };
  if (!z.uuid().safeParse(id).success) return { error: "Cliente inválido." };

  const datos = esquemaCliente.safeParse(datosDeForm(formData));
  if (!datos.success) return { errores: erroresDeCampo(datos.error) };
  const d = datos.data;

  let n: number;
  try {
    n = await comoUsuario(sesion.userId, (tx) =>
      tx.ejecutar(sql`
        update public.clientes
        set nombre = ${d.nombre}, telefono = ${d.telefono}, email = ${d.email ?? null}, notas = ${d.notas ?? null}
        where id = ${id}`),
    );
  } catch (e) {
    if (esErrorPg(e) && e.code === "23505") return { errores: { telefono: ["Ya hay otro cliente con ese celular."] } };
    return { error: mensajeDeError(e) };
  }
  if (!n) return { error: "No se encontró el cliente." };

  revalidatePath(`/panel/clientes/${id}`);
  return { ok: true, mensaje: "Cliente actualizado." };
}

/** Las inasistencias que tuvo hasta ahora dejan de limitar sus reservas online. */
export async function quitarLimiteCliente(id: string): Promise<EstadoAccion> {
  const sesion = await sesionParaAccion({ soloDueno: true });
  if (!sesion) return { error: "Solo el dueño puede quitar el límite." };
  if (!z.uuid().safeParse(id).success) return { error: "Cliente inválido." };

  let n: number;
  try {
    n = await comoUsuario(sesion.userId, (tx) =>
      tx.ejecutar(sql`update public.clientes set ausencias_perdonadas_at = now() where id = ${id}`),
    );
  } catch (e) {
    return { error: mensajeDeError(e) };
  }
  if (!n) return { error: "No se encontró el cliente." };

  revalidatePath(`/panel/clientes/${id}`);
  return { ok: true, mensaje: "Límite quitado." };
}
