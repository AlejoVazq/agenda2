import "server-only";
import { getSesionPanel } from "@/lib/auth";
import { comoUsuario, sql } from "@/lib/db";

/**
 * ¿El usuario actual puede conectar/desconectar el Google Calendar de este
 * profesional? El dueño, para cualquier profesional de su negocio; un empleado,
 * solo para su propia agenda.
 */
export async function sesionConPermisoSobreProfesional(profesionalId: string) {
  const sesion = await getSesionPanel();
  if (!sesion) return null;
  if (!sesion.esDueno) return sesion.perfil.profesional_id === profesionalId ? sesion : null;

  // RLS: solo devuelve el profesional si es del negocio del usuario.
  const prof = await comoUsuario(sesion.userId, (tx) =>
    tx.uno(sql`select id from public.profesionales where id = ${profesionalId}`),
  );
  return prof ? sesion : null;
}
