"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import QRCode from "qrcode";
import { z } from "zod";
import { APIError } from "better-auth/api";
import { crearLinkAcceso } from "@/lib/accesos";
import { sesionAdminParaAccion, type SesionAdmin } from "@/lib/admin";
import { auth } from "@/lib/better-auth";
import { comoUsuario, sql } from "@/lib/db";
import { mensajeDeError } from "@/lib/errores";
import { dentroDelLimite } from "@/lib/limites";
import type { EstadoAccion } from "@/lib/tipos";
import { datosDeForm, erroresDeCampo, esquemaCodigo, slug } from "@/lib/validaciones";
import { MEDIOS_PAGO, type NegocioAdmin } from "./tipos";

// Acciones de /admin. Cada una: admin con segundo factor (src/lib/admin.ts) →
// zod → la función plataforma.admin_* correspondiente, que vuelve a verificar
// en la base que sea admin y deja la acción en la auditoría.

const SIN_PERMISO: EstadoAccion = { error: "Tu sesión de administrador venció. Volvé a ingresar." };

const MENSAJES: Record<string, string> = {
  FALTA_MOTIVO: "Escribí el motivo.",
  DIAS_INVALIDOS: "Elegí entre 1 y 90 días.",
  NO_ENCONTRADO: "No encontramos ese registro (¿ya estaba anulado?).",
  SLUG_OCUPADO: "Esa dirección ya la usa otro negocio.",
};

function error(e: unknown): EstadoAccion {
  const texto = e instanceof Error ? e.message : "";
  for (const [codigo, mensaje] of Object.entries(MENSAJES)) {
    if (texto.includes(codigo)) return { error: mensaje };
  }
  return { error: mensajeDeError(e) };
}

const uuid = z.uuid("Negocio inválido");
const textoOpcional = (max: number) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(max).optional());

/** Corre la acción como el admin (RLS + verificación en la base) y refresca el detalle. */
async function comoAdmin(
  formData: FormData,
  esquema: z.ZodType<{ negocio_id: string }>,
  fn: (admin: SesionAdmin, datos: Record<string, unknown>) => Promise<string>,
): Promise<EstadoAccion> {
  const admin = await sesionAdminParaAccion();
  if (!admin) return SIN_PERMISO;
  const r = esquema.safeParse(datosDeForm(formData));
  if (!r.success) return { errores: erroresDeCampo(r.error) };
  let mensaje: string;
  try {
    mensaje = await fn(admin, r.data as Record<string, unknown>);
  } catch (e) {
    return error(e);
  }
  revalidatePath(`/admin/negocios/${r.data.negocio_id}`);
  revalidatePath("/admin");
  return { ok: true, mensaje };
}

// --- Suscripción -------------------------------------------------------------------

const esquemaPago = z.object({
  negocio_id: uuid,
  monto: z.coerce.number("Ingresá el monto").positive("Ingresá el monto").max(99_999_999),
  medio: z.enum(Object.keys(MEDIOS_PAGO) as [keyof typeof MEDIOS_PAGO], "Elegí el medio"),
  meses: z.coerce.number().int().min(1).max(24),
  nota: textoOpcional(300),
});

export async function registrarPago(_prev: EstadoAccion, formData: FormData): Promise<EstadoAccion> {
  return comoAdmin(formData, esquemaPago, async (admin, d) => {
    const p = d as z.infer<typeof esquemaPago>;
    await comoUsuario(admin.userId, (tx) =>
      tx.uno(sql`select plataforma.admin_registrar_pago(${p.negocio_id}, ${p.monto}, ${p.medio}, ${p.meses}, ${p.nota ?? null})`),
    );
    return p.meses === 1 ? "Pago registrado: un mes más." : `Pago registrado: ${p.meses} meses más.`;
  });
}

const esquemaAnular = z.object({
  negocio_id: uuid,
  pago_id: z.uuid(),
  motivo: z.string().trim().min(1, "Escribí el motivo").max(300),
});

export async function anularPago(_prev: EstadoAccion, formData: FormData): Promise<EstadoAccion> {
  return comoAdmin(formData, esquemaAnular, async (admin, d) => {
    const p = d as z.infer<typeof esquemaAnular>;
    await comoUsuario(admin.userId, (tx) => tx.uno(sql`select plataforma.admin_anular_pago(${p.pago_id}, ${p.motivo})`));
    return "Pago anulado.";
  });
}

const esquemaExtender = z.object({ negocio_id: uuid, dias: z.coerce.number().int().min(1).max(90) });

export async function extenderPrueba(_prev: EstadoAccion, formData: FormData): Promise<EstadoAccion> {
  return comoAdmin(formData, esquemaExtender, async (admin, d) => {
    const p = d as z.infer<typeof esquemaExtender>;
    await comoUsuario(admin.userId, (tx) => tx.uno(sql`select plataforma.admin_extender_prueba(${p.negocio_id}, ${p.dias})`));
    return `Prueba extendida ${p.dias} días.`;
  });
}

const esquemaSuspender = z.object({ negocio_id: uuid, motivo: textoOpcional(300) });

export async function suspender(_prev: EstadoAccion, formData: FormData): Promise<EstadoAccion> {
  return comoAdmin(formData, esquemaSuspender, async (admin, d) => {
    const p = d as z.infer<typeof esquemaSuspender>;
    await comoUsuario(admin.userId, (tx) => tx.uno(sql`select plataforma.admin_suspender(${p.negocio_id}, ${p.motivo ?? null})`));
    return "Negocio suspendido: el panel quedó en solo lectura y la página no toma reservas.";
  });
}

const soloNegocio = z.object({ negocio_id: uuid });

export async function reactivar(_prev: EstadoAccion, formData: FormData): Promise<EstadoAccion> {
  return comoAdmin(formData, soloNegocio, async (admin, d) => {
    await comoUsuario(admin.userId, (tx) => tx.uno(sql`select plataforma.admin_reactivar(${d.negocio_id as string})`));
    return "Negocio reactivado.";
  });
}

// --- Ayuda al negocio -----------------------------------------------------------------

const esquemaNota = z.object({ negocio_id: uuid, texto: z.string().trim().min(1, "Escribí la nota").max(2000) });

export async function agregarNota(_prev: EstadoAccion, formData: FormData): Promise<EstadoAccion> {
  return comoAdmin(formData, esquemaNota, async (admin, d) => {
    const p = d as z.infer<typeof esquemaNota>;
    await comoUsuario(admin.userId, (tx) => tx.uno(sql`select plataforma.admin_agregar_nota(${p.negocio_id}, ${p.texto})`));
    return "Nota guardada.";
  });
}

const esquemaSlug = z.object({ negocio_id: uuid, slug });

export async function cambiarSlug(_prev: EstadoAccion, formData: FormData): Promise<EstadoAccion> {
  return comoAdmin(formData, esquemaSlug, async (admin, d) => {
    const p = d as z.infer<typeof esquemaSlug>;
    await comoUsuario(admin.userId, (tx) => tx.uno(sql`select plataforma.admin_cambiar_slug(${p.negocio_id}, ${p.slug})`));
    return `Listo: ahora la página es /n/${p.slug}. Avisale al negocio que el link anterior dejó de funcionar.`;
  });
}

async function duenoDe(admin: SesionAdmin, negocioId: string) {
  const fila = await comoUsuario(admin.userId, (tx) =>
    tx.uno<{ d: NegocioAdmin }>(sql`select plataforma.admin_negocio(${negocioId}) as d`),
  );
  return fila?.d.equipo.find((u) => u.rol === "dueno") ?? null;
}

export type EstadoLinkAdmin = EstadoAccion & { link?: string };

/** Link de un solo uso (24 h) para que el dueño elija una contraseña nueva. Cierra sus sesiones al usarse. */
export async function linkAccesoDueno(_prev: EstadoLinkAdmin, formData: FormData): Promise<EstadoLinkAdmin> {
  const admin = await sesionAdminParaAccion();
  if (!admin) return SIN_PERMISO;
  const r = soloNegocio.safeParse(datosDeForm(formData));
  if (!r.success) return { error: "Negocio inválido." };
  try {
    const dueno = await duenoDe(admin, r.data.negocio_id);
    if (!dueno) return { error: "Este negocio no tiene dueño." };
    const link = await crearLinkAcceso(dueno.id, "recuperacion");
    await comoUsuario(admin.userId, (tx) =>
      tx.uno(sql`select plataforma.admin_registrar_accion('link_acceso_dueno', ${r.data.negocio_id}, '{}'::jsonb)`),
    );
    revalidatePath(`/admin/negocios/${r.data.negocio_id}`);
    return { ok: true, mensaje: `Link para ${dueno.nombre} (${dueno.email}). Vence en 24 horas:`, link };
  } catch (e) {
    return error(e);
  }
}

export async function reenviarVerificacion(_prev: EstadoAccion, formData: FormData): Promise<EstadoAccion> {
  return comoAdmin(formData, soloNegocio, async (admin, d) => {
    const dueno = await duenoDe(admin, d.negocio_id as string);
    if (!dueno) throw new Error("NO_ENCONTRADO");
    if (dueno.email_verificado) return "El dueño ya confirmó su mail.";
    await auth.api.sendVerificationEmail({ body: { email: dueno.email, callbackURL: "/login?verificado=1" } });
    await comoUsuario(admin.userId, (tx) =>
      tx.uno(sql`select plataforma.admin_registrar_accion('reenviar_verificacion', ${d.negocio_id as string}, '{}'::jsonb)`),
    );
    return `Le reenviamos el mail de confirmación a ${dueno.email}.`;
  });
}

// --- Segundo factor del admin -------------------------------------------------------------

export type EstadoDosFactores = EstadoAccion & { qr?: string; secreto?: string; codigosRespaldo?: string[] };

/** Paso 1: con la contraseña, genera el secreto y devuelve el QR y los códigos de respaldo. */
export async function activarDosFactores(_prev: EstadoDosFactores, formData: FormData): Promise<EstadoDosFactores> {
  const admin = await sesionAdminParaAccion({ sinDosFactores: true });
  if (!admin) return SIN_PERMISO;
  const password = formData.get("password");
  if (typeof password !== "string" || !password) return { errores: { password: ["Ingresá tu contraseña"] } };
  if (!(await dentroDelLimite("2fa-activar", 5, 600))) return { error: "Demasiados intentos. Esperá unos minutos." };
  try {
    const r = await auth.api.enableTwoFactor({ body: { password, method: "totp" }, headers: await headers() });
    if (r.method !== "totp") throw new Error("Better Auth no devolvió un TOTP");
    const secreto = new URL(r.totpURI).searchParams.get("secret") ?? undefined;
    const qr = await QRCode.toDataURL(r.totpURI, { margin: 1, width: 220 });
    return { ok: true, qr, secreto, codigosRespaldo: r.backupCodes };
  } catch (e) {
    if (!(e instanceof APIError)) console.error("[2fa]", e);
    return { errores: { password: ["La contraseña no es correcta"] } };
  }
}

/** Paso 2: el primer código de la app confirma y activa el segundo factor. */
export async function confirmarDosFactores(_prev: EstadoDosFactores, formData: FormData): Promise<EstadoDosFactores> {
  const admin = await sesionAdminParaAccion({ sinDosFactores: true });
  if (!admin) return SIN_PERMISO;
  const r = esquemaCodigo.safeParse(datosDeForm(formData));
  if (!r.success || !/^\d{6}$/.test(r.data.codigo)) return { errores: { codigo: ["Ingresá los 6 números de la app"] } };
  if (!(await dentroDelLimite("2fa-confirmar", 10, 600))) return { error: "Demasiados intentos. Esperá unos minutos." };
  try {
    await auth.api.verifyTOTP({ body: { code: r.data.codigo }, headers: await headers() });
  } catch (e) {
    if (!(e instanceof APIError)) console.error("[2fa]", e);
    return { errores: { codigo: ["El código no es correcto. Fijate que la hora del celular esté bien."] } };
  }
  redirect("/admin");
}
