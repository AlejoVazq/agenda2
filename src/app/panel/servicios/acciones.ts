"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { sesionParaAccion } from "@/lib/auth";
import { comoUsuario, esErrorPg, sql } from "@/lib/db";
import { mensajeDeError } from "@/lib/errores";
import { datosDeForm, erroresDeCampo, esquemaServicio } from "@/lib/validaciones";
import type { EstadoAccion } from "@/lib/tipos";

const SIN_PERMISO: EstadoAccion = { error: "Solo el dueño del negocio puede modificar los servicios." };

export async function guardarServicio(
  id: string | null,
  _prev: EstadoAccion,
  formData: FormData,
): Promise<EstadoAccion> {
  const sesion = await sesionParaAccion({ soloDueno: true });
  if (!sesion) return SIN_PERMISO;
  if (id && !z.uuid().safeParse(id).success) return { error: "Servicio inválido." };

  const datos = esquemaServicio.safeParse(datosDeForm(formData));
  if (!datos.success) return { errores: erroresDeCampo(datos.error) };
  const d = datos.data;

  try {
    await comoUsuario(sesion.userId, async (tx) => {
      if (id) {
        await tx.ejecutar(sql`
          update public.servicios
          set nombre = ${d.nombre}, descripcion = ${d.descripcion ?? null}, duracion_min = ${d.duracion_min},
              precio = ${d.precio}, activo = ${d.activo}
          where id = ${id} and negocio_id = ${sesion.negocio.id}`);
        return;
      }
      const nuevo = await tx.uno<{ id: string }>(sql`
        insert into public.servicios (negocio_id, nombre, descripcion, duracion_min, precio, activo)
        values (${sesion.negocio.id}, ${d.nombre}, ${d.descripcion ?? null}, ${d.duracion_min}, ${d.precio}, ${d.activo})
        returning id`);

      // Con un solo profesional no hay nada que elegir: si no, el servicio no se podría reservar.
      const profesionales = await tx.varios<{ id: string }>(sql`
        select id from public.profesionales where negocio_id = ${sesion.negocio.id} and activo limit 2`);
      if (nuevo && profesionales.length === 1) {
        await tx.ejecutar(sql`
          insert into public.profesional_servicio (negocio_id, profesional_id, servicio_id)
          values (${sesion.negocio.id}, ${profesionales[0].id}, ${nuevo.id})`);
      }
    });
  } catch (e) {
    return { error: mensajeDeError(e) };
  }

  revalidatePath("/panel/servicios");
  redirect("/panel/servicios");
}

export async function eliminarServicio(id: string): Promise<EstadoAccion> {
  const sesion = await sesionParaAccion({ soloDueno: true });
  if (!sesion) return SIN_PERMISO;
  if (!z.uuid().safeParse(id).success) return { error: "Servicio inválido." };

  try {
    await comoUsuario(sesion.userId, (tx) =>
      tx.ejecutar(sql`delete from public.servicios where id = ${id} and negocio_id = ${sesion.negocio.id}`),
    );
  } catch (e) {
    if (esErrorPg(e) && e.code === "23503") {
      return { error: "Este servicio tiene turnos registrados. En lugar de borrarlo, desactivalo." };
    }
    return { error: mensajeDeError(e) };
  }

  revalidatePath("/panel/servicios");
  redirect("/panel/servicios");
}
