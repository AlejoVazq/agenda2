import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/better-auth";
import { comoUsuario, sql } from "@/lib/db";
import { estaHabilitado, type Suscripcion } from "@/lib/suscripcion";
import type { Negocio, Perfil } from "@/lib/tipos";

// Segunda capa de seguridad (la primera es src/proxy.ts; la tercera, RLS):
// cada página y Server Action del panel valida la sesión contra la base y
// verifica perfil y rol antes de hacer nada.

export type Sesion = {
  userId: string;
  email: string;
  nombre: string;
  /** Tiene activado el segundo factor (obligatorio para los admins de la plataforma). */
  dosFactores: boolean;
};

export type SesionPanel = Sesion & {
  perfil: Perfil;
  negocio: Negocio;
  esDueno: boolean;
  suscripcion: Suscripcion;
  /** Prueba, activa o en gracia. Si no, el panel es de solo lectura (ver src/lib/suscripcion.ts). */
  habilitado: boolean;
};

/** Usuario con sesión válida (verificada en la base) o null. Se memoiza por request. */
export const getSesion = cache(async (): Promise<Sesion | null> => {
  const datos = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  if (!datos?.user) return null;
  return {
    userId: datos.user.id,
    email: datos.user.email,
    nombre: datos.user.name,
    dosFactores: Boolean(datos.user.twoFactorEnabled),
  };
});

/** ¿Es administrador de la plataforma? (plataforma.administradores, ver src/lib/admin.ts) */
export const esAdministrador = cache(async (userId: string): Promise<boolean> => {
  const fila = await comoUsuario(userId, (tx) => tx.uno<{ admin: boolean }>(sql`select plataforma.es_admin() as admin`));
  return Boolean(fila?.admin);
});

/** Perfil + negocio del usuario actual, o null si no pertenece a ningún negocio. */
export const getSesionPanel = cache(async (): Promise<SesionPanel | null> => {
  const sesion = await getSesion();
  if (!sesion) return null;

  const fila = await comoUsuario(sesion.userId, (tx) =>
    tx.uno<Perfil & { negocio: Negocio; suscripcion: Suscripcion }>(sql`
      select p.id, p.negocio_id, p.rol, p.nombre, p.profesional_id, to_jsonb(n) as negocio,
        public.mi_suscripcion() as suscripcion
      from public.perfiles p
      join public.negocios n on n.id = p.negocio_id
      where p.id = ${sesion.userId}`),
  );
  if (!fila) return null;
  const { negocio, suscripcion, ...perfil } = fila;
  return {
    ...sesion,
    perfil,
    negocio,
    esDueno: perfil.rol === "dueno",
    suscripcion,
    habilitado: estaHabilitado(suscripcion.estado),
  };
});

/** Para páginas del panel: exige login y pertenecer a un negocio. */
export async function requerirPanel(): Promise<SesionPanel> {
  const sesion = await getSesion();
  if (!sesion) redirect("/login");
  const panel = await getSesionPanel();
  if (!panel) redirect((await esAdministrador(sesion.userId)) ? "/admin" : "/onboarding");
  return panel;
}

/** Para páginas solo de dueño: un empleado vuelve al inicio del panel. */
export async function requerirDueno(): Promise<SesionPanel> {
  const panel = await requerirPanel();
  if (!panel.esDueno) redirect("/panel");
  return panel;
}

/**
 * Para Server Actions: devuelve la sesión del panel o null (sin redirigir),
 * así la acción puede responder con un error controlado.
 */
export async function sesionParaAccion(opciones: { soloDueno?: boolean } = {}) {
  const panel = await getSesionPanel();
  if (!panel) return null;
  if (opciones.soloDueno && !panel.esDueno) return null;
  return panel;
}
