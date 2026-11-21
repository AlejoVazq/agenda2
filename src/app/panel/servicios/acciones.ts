"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { sesionParaAccion } from "@/lib/auth";
import { comoUsuario, esErrorPg, sql } from "@/lib/db";
import { mensajeDeError } from "@/lib/errores";
import { datosDeForm, erroresDeCampo, esquemaServicio, profesionalesDelServicio } from "@/lib/validaciones";
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
  // El número solo tiene sentido en un servicio de emergencia.
  const contacto = d.emergencia ? d.contacto_whatsapp : null;

  try {
    await comoUsuario(sesion.userId, async (tx) => {
      let servicioId = id;
      if (id) {
        await tx.ejecutar(sql`
          update public.servicios
          set nombre = ${d.nombre}, descripcion = ${d.descripcion ?? null}, duracion_min = ${d.duracion_min},
              precio = ${d.precio}, activo = ${d.activo}, emergencia = ${d.emergencia}, contacto_whatsapp = ${contacto}
          where id = ${id} and negocio_id = ${sesion.negocio.id}`);
      } else {
        const nuevo = await tx.uno<{ id: string }>(sql`
          insert into public.servicios (negocio_id, nombre, descripcion, duracion_min, precio, activo, emergencia, contacto_whatsapp)
          values (${sesion.negocio.id}, ${d.nombre}, ${d.descripcion ?? null}, ${d.duracion_min}, ${d.precio}, ${d.activo},
                  ${d.emergencia}, ${contacto})
          returning id`);
        servicioId = nuevo?.id ?? null;
      }
      // Los de emergencia no se reservan online: quién lo hace queda como estaba.
      if (d.emergencia || !servicioId) return;

      // Quién lo hace: los activos salen del formulario; los inactivos quedan como estaban.
      const profesionales = await tx.varios<{ id: string; activo: boolean }>(sql`
        select id, activo from public.profesionales where negocio_id = ${sesion.negocio.id}`);
      const { filas, errores } = profesionalesDelServicio(
        formData,
        profesionales.filter((p) => p.activo).map((p) => p.id),
      );
      // Lanzar deshace también lo del servicio.
      if (Object.keys(errores).length) throw new ErroresDeCampo(errores);
      const inactivos = await tx.varios<{ profesional_id: string; precio: number | null; duracion_min: number | null }>(sql`
        select ps.profesional_id, ps.precio, ps.duracion_min
        from public.profesional_servicio ps join public.profesionales p on p.id = ps.profesional_id
        where ps.servicio_id = ${servicioId} and not p.activo`);
      // Igual al general = vacío, así sigue al servicio si después cambia.
      const propias = filas.map((f) => ({
        profesional_id: f.profesional_id,
        precio: f.precio === d.precio ? null : f.precio,
        duracion_min: f.duracion_min === d.duracion_min ? null : f.duracion_min,
      }));
      await tx.ejecutar(sql`
        select public.guardar_profesionales_servicio(${servicioId}, ${JSON.stringify([...propias, ...inactivos])}::jsonb)`);
    });
  } catch (e) {
    if (e instanceof ErroresDeCampo) return { errores: e.errores };
    return { error: mensajeDeError(e) };
  }

  revalidatePath("/panel/servicios");
  redirect("/panel/servicios");
}

class ErroresDeCampo extends Error {
  constructor(readonly errores: Record<string, string[]>) {
    super("errores de campo");
  }
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
