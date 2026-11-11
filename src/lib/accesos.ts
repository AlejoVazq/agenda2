import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { auth } from "@/lib/better-auth";
import { comoServidor, sql } from "@/lib/db";
import { env } from "@/lib/env";

// Accesos del equipo: el dueño crea el usuario de un empleado y le comparte a
// mano (WhatsApp, etc.) un link de un solo uso para que elija su contraseña,
// la primera vez o si la olvidó. Se guarda el hash del token, nunca el token.
//
// Las cuentas se tocan con la API interna de Better Auth (la misma que usa su
// plugin de administración); los links, con el rol del servidor. Llamar solo
// después de verificar que quien pide es el dueño del negocio.

const VIGENCIA_HORAS = 24;
export type TipoAcceso = "invitacion" | "recuperacion";

const hashDe = (token: string) => createHash("sha256").update(token).digest("hex");
export const tokenValido = (token: string) => /^[0-9a-f]{64}$/.test(token);

async function contexto() {
  return auth.$context;
}

/** Crea un link nuevo para el usuario y anula los anteriores sin usar. */
export async function crearLinkAcceso(usuarioId: string, tipo: TipoAcceso): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await comoServidor(async (tx) => {
    await tx.ejecutar(sql`delete from public.accesos where usuario_id = ${usuarioId} and usado_at is null`);
    await tx.ejecutar(sql`
      insert into public.accesos (usuario_id, tipo, token_hash, expira_at)
      values (${usuarioId}, ${tipo}, ${hashDe(token)}, now() + make_interval(hours => ${VIGENCIA_HORAS}))`);
  });
  return `${env.siteUrl}/acceso/${token}`;
}

/** Datos del link (para mostrar la página), o null si no existe, venció o ya se usó. */
export async function verLinkAcceso(token: string) {
  if (!tokenValido(token)) return null;
  return comoServidor((tx) =>
    tx.uno<{ tipo: TipoAcceso; email: string; nombre: string }>(sql`
      select a.tipo, u."email" as email, u."name" as nombre
      from public.accesos a
      join auth."user" u on u."id" = a.usuario_id
      where a.token_hash = ${hashDe(token)} and a.usado_at is null and a.expira_at > now()`),
  );
}

/**
 * Canjea el link: guarda la contraseña y marca el mail como verificado (el
 * link lo generó el dueño para esa persona, como antes la invitación de
 * Supabase). Si era una recuperación, cierra las demás sesiones.
 * Devuelve el email para iniciar sesión, o null si el link no sirve.
 */
export async function canjearLinkAcceso(token: string, password: string): Promise<string | null> {
  if (!tokenValido(token)) return null;
  // Se marca usado primero (atómico): dos envíos simultáneos no canjean dos veces.
  const acceso = await comoServidor((tx) =>
    tx.uno<{ id: string; usuario_id: string; tipo: TipoAcceso; email: string }>(sql`
      update public.accesos a set usado_at = now()
      from auth."user" u
      where u."id" = a.usuario_id
        and a.token_hash = ${hashDe(token)} and a.usado_at is null and a.expira_at > now()
      returning a.id, a.usuario_id, a.tipo, u."email" as email`),
  );
  if (!acceso) return null;

  try {
    const ctx = await contexto();
    const hash = await ctx.password.hash(password);
    const cuentas = await ctx.internalAdapter.findAccounts(acceso.usuario_id);
    if (cuentas.some((c) => c.providerId === "credential")) {
      await ctx.internalAdapter.updatePassword(acceso.usuario_id, hash);
    } else {
      await ctx.internalAdapter.linkAccount({
        userId: acceso.usuario_id,
        providerId: "credential",
        accountId: acceso.usuario_id,
        password: hash,
      });
    }
    await ctx.internalAdapter.updateUser(acceso.usuario_id, { emailVerified: true });
    if (acceso.tipo === "recuperacion") await ctx.internalAdapter.deleteUserSessions(acceso.usuario_id);
    return acceso.email;
  } catch (e) {
    // No se pudo guardar: el link vuelve a quedar disponible.
    await comoServidor((tx) => tx.ejecutar(sql`update public.accesos set usado_at = null where id = ${acceso.id}`));
    throw e;
  }
}

/** ¿El usuario ya eligió su contraseña alguna vez? */
export async function tieneContrasena(usuarioId: string) {
  const ctx = await contexto();
  const cuentas = await ctx.internalAdapter.findAccounts(usuarioId);
  return cuentas.some((c) => c.providerId === "credential" && Boolean(c.password));
}

/** Crea el usuario de un empleado (sin contraseña todavía). Null si el email ya tiene cuenta. */
export async function crearUsuarioEmpleado(email: string, nombre: string): Promise<string | null> {
  const ctx = await contexto();
  if (await ctx.internalAdapter.findUserByEmail(email)) return null;
  // Igual que el plugin de administración de Better Auth (method: "admin").
  const usuario = await ctx.internalAdapter.createUser({ email, name: nombre, emailVerified: false }, { method: "admin" });
  return usuario.id;
}

/** Borra el usuario: en cascada se van su perfil, sus sesiones y sus links. */
export async function borrarUsuario(usuarioId: string) {
  const ctx = await contexto();
  await ctx.internalAdapter.deleteUser(usuarioId);
}
