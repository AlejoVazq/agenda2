import "server-only";
import { notFound, redirect } from "next/navigation";
import { esAdministrador, getSesion, type Sesion } from "@/lib/auth";

// Panel de la plataforma (/admin): negocios, suscripciones y pagos.
//
// Capas, igual que el panel de los negocios:
//   1. src/proxy.ts: /admin exige sesión.
//   2. Acá: la cuenta tiene que estar en plataforma.administradores y tener el
//      segundo factor activado (si no, solo puede entrar a /admin/seguridad).
//      A quien no es admin, /admin le da 404: no se revela que existe.
//   3. La base: cada plataforma.admin_* vuelve a verificar que app.usuario_id()
//      sea administrador, y ningún rol de la app toca las tablas de plataforma.
//
// Los administradores se agregan desde el servidor: npm run admin -- agregar <mail>.

export type SesionAdmin = Sesion;

/** Sesión de un administrador (con o sin segundo factor), o null. */
async function getSesionAdmin(): Promise<SesionAdmin | null> {
  const sesion = await getSesion();
  if (!sesion) return null;
  return (await esAdministrador(sesion.userId)) ? sesion : null;
}

/** Para páginas de /admin. Sin segundo factor, manda a configurarlo. */
export async function requerirAdmin({ sinDosFactores = false } = {}): Promise<SesionAdmin> {
  const sesion = await getSesion();
  if (!sesion) redirect("/login?next=/admin");
  const admin = await getSesionAdmin();
  if (!admin) notFound();
  if (!admin.dosFactores && !sinDosFactores) redirect("/admin/seguridad");
  return admin;
}

/** Para Server Actions de /admin: el admin con segundo factor, o null. */
export async function sesionAdminParaAccion({ sinDosFactores = false } = {}): Promise<SesionAdmin | null> {
  const admin = await getSesionAdmin();
  if (!admin) return null;
  if (!admin.dosFactores && !sinDosFactores) return null;
  return admin;
}
