import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { crearSupabaseServidor } from "@/lib/supabase/server";
import type { Negocio, Perfil } from "@/lib/tipos";

export type Sesion = {
  userId: string;
  email: string | null;
};

export type SesionPanel = Sesion & {
  perfil: Perfil;
  negocio: Negocio;
  esDueno: boolean;
};

/** Usuario autenticado (JWT verificado) o null. Se memoiza por request. */
export const getSesion = cache(async (): Promise<Sesion | null> => {
  const supabase = await crearSupabaseServidor();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  return { userId: claims.sub, email: (claims.email as string | undefined) ?? null };
});

/** Perfil + negocio del usuario actual, o null si no pertenece a ningún negocio. */
export const getSesionPanel = cache(async (): Promise<SesionPanel | null> => {
  const sesion = await getSesion();
  if (!sesion) return null;

  const supabase = await crearSupabaseServidor();
  const { data } = await supabase
    .from("perfiles")
    .select("id, negocio_id, rol, nombre, profesional_id, negocio:negocios(*)")
    .eq("id", sesion.userId)
    .maybeSingle();

  if (!data?.negocio) return null;
  const { negocio, ...perfil } = data as unknown as Perfil & { negocio: Negocio };
  return { ...sesion, perfil, negocio, esDueno: perfil.rol === "dueno" };
});

/** Para páginas del panel: exige login y pertenecer a un negocio. */
export async function requerirPanel(): Promise<SesionPanel> {
  const sesion = await getSesion();
  if (!sesion) redirect("/login");
  const panel = await getSesionPanel();
  if (!panel) redirect("/onboarding");
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
