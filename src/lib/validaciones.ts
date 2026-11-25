import { z } from "zod";
import { RUBROS, type MedioPago } from "@/lib/tipos";
import { MENSAJE_TELEFONO, telefonoLocal } from "@/lib/telefono-local";
import { normalizarTelefono } from "@/lib/whatsapp";

// --- Helpers para FormData ---------------------------------------------------------

/** Texto obligatorio, recortado. */
const texto = (min: number, max: number, nombre = "Este campo") =>
  z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : ""),
    z
      .string()
      .min(min, min <= 1 ? `${nombre} es obligatorio` : `${nombre} debe tener al menos ${min} caracteres`)
      .max(max, `${nombre} no puede superar ${max} caracteres`),
  );

/** Texto opcional: "" o ausente => null. */
const textoOpcional = (max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null),
    z.string().max(max, `Máximo ${max} caracteres`).nullable(),
  );

/** Checkbox de formulario => boolean. */
const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());

const entero = (min: number, max: number, nombre = "El valor") =>
  z.coerce
    .number({ error: `${nombre} debe ser un número` })
    .int(`${nombre} debe ser un número entero`)
    .min(min, `${nombre} debe ser como mínimo ${min}`)
    .max(max, `${nombre} debe ser como máximo ${max}`);

const emailOpcional = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? v.trim().toLowerCase() : null),
  z.email("Ingresá un email válido").max(254).nullable(),
);

const emailObligatorio = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toLowerCase() : ""),
  z.email("Ingresá un email válido").max(254),
);

export const telefono = z.preprocess(
  (v) => (typeof v === "string" ? normalizarTelefono(v) : ""),
  z.string().regex(/^[0-9]{8,15}$/, "Ingresá un teléfono válido, con código de área (ej: 341 555 1234)"),
);

/** Teléfono de la ciudad (característica fija, ver telefono-local.ts). Vacío => null. */
const telefonoDeLaCiudad = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? (telefonoLocal(v) ?? "invalido") : null),
  z.string().regex(/^[0-9]{10}$/, MENSAJE_TELEFONO).nullable(),
);
const telefonoDeLaCiudadObligatorio = telefonoDeLaCiudad.refine((v) => v !== null, "El teléfono es obligatorio");

const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, "Hora inválida");

export const slug = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toLowerCase() : ""),
  z
    .string()
    .min(3, "Mínimo 3 caracteres")
    .max(50, "Máximo 50 caracteres")
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Solo minúsculas, números y guiones (ej: salon-luna)"),
);

const rubro = z.enum(Object.keys(RUBROS) as [keyof typeof RUBROS, ...(keyof typeof RUBROS)[]], {
  error: "Elegí un rubro",
});

/** Acepta "8000", "8000.50" (input number) o formato argentino "8.000,50". */
function parsearPrecio(v: string) {
  if (/^\d+(\.\d{1,2})?$/.test(v)) return Number(v);
  return Number(v.replace(/\$|\s/g, "").replace(/\./g, "").replace(",", "."));
}

export function datosDeForm(formData: FormData) {
  return Object.fromEntries(formData.entries());
}

export function erroresDeCampo(error: z.ZodError) {
  return z.flattenError(error).fieldErrors as Record<string, string[] | undefined>;
}

// --- Auth ---------------------------------------------------------------------------

export const esquemaLogin = z.object({
  email: z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : v), z.email("Ingresá un email válido")),
  password: z.string().min(1, "Ingresá tu contraseña"),
});

/** Código de la app autenticadora (6 dígitos) o uno de respaldo (10 caracteres). */
export const esquemaCodigo = z.object({
  codigo: z.preprocess(
    (v) => (typeof v === "string" ? v.replace(/\s+/g, "") : v),
    z.string().regex(/^(\d{6}|[A-Za-z0-9]{5}-?[A-Za-z0-9]{5})$/, "Ingresá el código de 6 números"),
  ),
});

export const esquemaRegistro = z.object({
  nombre: texto(2, 80, "Tu nombre"),
  email: z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : v), z.email("Ingresá un email válido")),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres").max(72),
});

export const esquemaPassword = z
  .object({
    password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres").max(72),
    confirmacion: z.string(),
  })
  .refine((d) => d.password === d.confirmacion, { path: ["confirmacion"], message: "Las contraseñas no coinciden" });

// --- Negocio ------------------------------------------------------------------------

/** Instagram: acepta "@usuario", "usuario" o el link del perfil; guarda solo el usuario. */
const instagram = z.preprocess(
  (v) => {
    if (typeof v !== "string") return null;
    const t = v
      .trim()
      .replace(/^(https?:\/\/)?(www\.)?instagram\.com\//i, "")
      .replace(/^@/, "")
      .replace(/[/?#].*$/, "")
      .toLowerCase();
    return t === "" ? null : t;
  },
  z
    .string()
    .regex(/^[a-z0-9._]{1,30}$/, "Escribí tu usuario de Instagram (por ejemplo, @tunegocio)")
    .nullable(),
);

export const esquemaOnboarding = z.object({
  nombre: texto(2, 80, "El nombre"),
  slug,
  rubro,
  nombre_dueno: texto(2, 80, "Tu nombre"),
  telefono: telefonoDeLaCiudadObligatorio,
  direccion: textoOpcional(160),
  dueno_atiende: checkbox,
});

export const esquemaNegocio = z.object({
  nombre: texto(2, 80, "El nombre"),
  slug,
  rubro,
  telefono: telefonoDeLaCiudadObligatorio,
  direccion: textoOpcional(160),
  instagram,
  descripcion: textoOpcional(500),
  cancelacion_min_horas: entero(0, 168, "Las horas"),
  anticipacion_min_min: entero(0, 10080, "La anticipación mínima"),
  anticipacion_max_dias: entero(1, 365, "Los días"),
  intervalo_min: z.coerce
    .number()
    .refine((v) => [5, 10, 15, 20, 30, 60].includes(v), "Intervalo inválido"),
  confirmacion_automatica: checkbox,
  recordatorio_horas: entero(0, 72, "Las horas"),
});

export const esquemaSena = z
  .object({
    sena_tipo: z.enum(["ninguna", "porcentaje", "fijo"], { error: "Elegí un tipo de seña" }),
    sena_valor: z.preprocess(
      (v) => (typeof v === "string" && v.trim() !== "" ? parsearPrecio(v.trim()) : 0),
      z.number({ error: "Monto inválido" }).min(0, "No puede ser negativo").max(99_999_999),
    ),
    pago_plazo_min: entero(10, 1440, "El plazo"),
  })
  .refine((d) => d.sena_tipo !== "porcentaje" || (d.sena_valor >= 1 && d.sena_valor <= 100), {
    path: ["sena_valor"],
    message: "El porcentaje tiene que estar entre 1 y 100",
  })
  .refine((d) => d.sena_tipo !== "fijo" || d.sena_valor >= 1, {
    path: ["sena_valor"],
    message: "Ingresá el monto de la seña",
  });

// --- Servicios y profesionales ---------------------------------------------------------

export const esquemaServicio = z
  .object({
    nombre: texto(2, 80, "El nombre"),
    descripcion: textoOpcional(300),
    duracion_min: entero(5, 600, "La duración"),
    precio: z.preprocess(
      (v) => (typeof v === "string" && v.trim() !== "" ? parsearPrecio(v.trim()) : null),
      z.number({ error: "Precio inválido" }).min(0, "El precio no puede ser negativo").max(99_999_999).nullable(),
    ),
    activo: checkbox,
    emergencia: checkbox,
    contacto_whatsapp: telefonoDeLaCiudad,
  })
  .refine((d) => !d.emergencia || d.contacto_whatsapp !== null, {
    path: ["contacto_whatsapp"],
    message: "Poné el WhatsApp de quien hace el servicio",
  });

const precioOpcional = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? parsearPrecio(v.trim()) : null),
  z.number({ error: "Precio inválido" }).min(0, "El precio no puede ser negativo").max(99_999_999).nullable(),
);

/**
 * Quién hace un servicio y con qué precio y duración. Del formulario: `hace_<id>`
 * (casilla), `precio_<id>` y `duracion_<id>` (vacío = los del servicio).
 */
export function profesionalesDelServicio(formData: FormData, profesionalIds: string[]) {
  const filas: { profesional_id: string; precio: number | null; duracion_min: number | null }[] = [];
  const errores: Record<string, string[]> = {};
  for (const id of profesionalIds) {
    if (!formData.has(`hace_${id}`)) continue;
    const precio = precioOpcional.safeParse(formData.get(`precio_${id}`));
    const crudo = String(formData.get(`duracion_${id}`) ?? "").trim();
    const duracion = crudo === "" ? { success: true as const, data: null } : entero(5, 600, "La duración").safeParse(crudo);
    if (!precio.success) errores[`precio_${id}`] = [precio.error.issues[0]?.message ?? "Precio inválido"];
    if (!duracion.success) errores[`duracion_${id}`] = [duracion.error.issues[0]?.message ?? "Duración inválida"];
    if (precio.success && duracion.success) filas.push({ profesional_id: id, precio: precio.data, duracion_min: duracion.data });
  }
  return { filas, errores };
}

export const esquemaProfesional = z.object({
  nombre: texto(2, 80, "El nombre"),
  email: emailOpcional,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color inválido"),
  activo: checkbox,
});

export const esquemaFranjas = z
  .array(
    z
      .object({ dia_semana: z.number().int().min(0).max(6), desde: hora, hasta: hora })
      .refine((f) => f.desde < f.hasta, { message: "La hora de inicio debe ser anterior a la de fin" }),
  )
  .max(50)
  .superRefine((franjas, ctx) => {
    for (let d = 0; d <= 6; d++) {
      const delDia = franjas.filter((f) => f.dia_semana === d).sort((a, b) => a.desde.localeCompare(b.desde));
      for (let i = 1; i < delDia.length; i++) {
        if (delDia[i].desde < delDia[i - 1].hasta) {
          ctx.addIssue({ code: "custom", message: "Hay franjas que se superponen en el mismo día" });
          return;
        }
      }
    }
  });

export const esquemaBloqueo = z
  .object({
    profesional_id: z.uuid(),
    desde: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Fecha inválida"),
    hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Fecha inválida"),
    motivo: textoOpcional(120),
  })
  .refine((b) => b.desde < b.hasta, { path: ["hasta"], message: "El fin debe ser posterior al inicio" });

export const esquemaInvitacion = z.object({
  nombre: texto(2, 80, "El nombre"),
  email: z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : v), z.email("Ingresá un email válido")),
  profesional_id: z.uuid("Elegí un profesional"),
  /** "dueno" = socio: maneja todo el negocio, con su propia agenda. */
  rol: z.enum(["empleado", "dueno"]).default("empleado"),
});

// --- Reservas -------------------------------------------------------------------------

export const esquemaConsultaHorarios = z.object({
  negocio_id: z.uuid(),
  servicio_id: z.uuid(),
  profesional_id: z.uuid().nullable(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const esquemaReserva = z.object({
  negocio_id: z.uuid(),
  servicio_id: z.uuid(),
  profesional_id: z.preprocess((v) => (v === "" || v === "cualquiera" ? null : v), z.uuid().nullable()),
  inicio: z.iso.datetime({ offset: true }),
  nombre: texto(2, 80, "Tu nombre"),
  telefono,
  email: emailObligatorio,
});

export const esquemaTurnoPanel = z.object({
  profesional_id: z.uuid("Elegí un profesional"),
  servicio_id: z.uuid("Elegí un servicio"),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
  hora,
  cliente_nombre: texto(2, 80, "El nombre"),
  cliente_telefono: telefono,
  cliente_email: emailOpcional,
  notas: textoOpcional(500),
  /** 0 = una sola vez; 1 = todas las semanas; 2 = cada 2 semanas (turno fijo). */
  repetir: z.enum(["0", "1", "2"]).default("0").transform(Number),
});

export const esquemaMoverTurno = z.object({
  id: z.uuid(),
  inicio: z.iso.datetime({ offset: true }),
  fin: z.iso.datetime({ offset: true }),
  profesional_id: z.uuid().optional(),
});

export const esquemaEstadoTurno = z.object({
  id: z.uuid(),
  estado: z.enum(["pendiente", "confirmado", "cancelado", "completado", "ausente"]),
});

export const esquemaCliente = z.object({
  nombre: texto(2, 80, "El nombre"),
  telefono,
  email: emailOpcional,
  notas: textoOpcional(500),
});

export const token = z.string().regex(/^[0-9a-f]{64}$/);

export const esquemaResena = z.object({
  token,
  estrellas: entero(1, 5, "La puntuación"),
  comentario: textoOpcional(600),
});

/** Opinión sin turno, desde la página del negocio. */
export const esquemaResenaLibre = z.object({
  negocio_id: z.uuid(),
  nombre: texto(2, 60, "Tu nombre"),
  estrellas: entero(1, 5, "La puntuación"),
  comentario: textoOpcional(600),
  profesional_id: z.preprocess((v) => (v === "" ? null : v), z.uuid().nullable().optional()),
});

export const esquemaRespuestaResena = z.object({
  id: z.uuid(),
  respuesta: textoOpcional(600),
});

// --- Productos y pedidos ----------------------------------------------------------------

const MEDIOS = ["mercadopago", "transferencia", "efectivo"] as const satisfies readonly MedioPago[];
const medio = z.enum(MEDIOS, { error: "Elegí cómo pagar" });

export const esquemaProducto = z.object({
  nombre: texto(2, 80, "El nombre"),
  descripcion: textoOpcional(500),
  precio: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? parsearPrecio(v.trim()) : typeof v === "number" ? v : undefined),
    z
      .number({ error: "Ingresá el precio" })
      .gt(0, "El precio tiene que ser mayor a 0")
      .max(99_999_999, "Precio demasiado alto"),
  ),
  stock: entero(0, 100_000, "El stock"),
  activo: checkbox,
  orden: z.preprocess((v) => (v === "" || v === undefined || v === null ? 0 : v), entero(-100_000, 100_000, "El orden")),
});

/**
 * Configuración de la tienda. `tienda_medios` llega como varias casillas con el mismo
 * nombre: usar `formData.getAll("tienda_medios")` al armar el objeto.
 */
export const esquemaTienda = z
  .object({
    tienda_activa: checkbox,
    tienda_medios: z
      .preprocess((v) => (Array.isArray(v) ? [...new Set(v)] : v === undefined || v === "" ? [] : [v]), z.array(medio))
      .refine((m) => m.length >= 1, "Elegí al menos un medio de pago"),
    transferencia_alias: z.preprocess(
      (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null),
      z
        .string()
        .regex(/^[A-Za-z0-9.-]{6,20}$/, "El alias tiene entre 6 y 20 letras, números, puntos o guiones")
        .nullable(),
    ),
    transferencia_cbu: z.preprocess(
      (v) => (typeof v === "string" && v.replace(/\s|-/g, "") !== "" ? v.replace(/\s|-/g, "") : null),
      z.string().regex(/^\d{22}$/, "El CBU o CVU tiene 22 números").nullable(),
    ),
    transferencia_titular: z.preprocess(
      (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null),
      z.string().min(2, "Mínimo 2 caracteres").max(80, "Máximo 80 caracteres").nullable(),
    ),
    transferencia_plazo_horas: entero(1, 168, "El plazo"),
    efectivo_plazo_dias: entero(1, 14, "El plazo"),
  })
  .refine((d) => !d.tienda_medios.includes("transferencia") || d.transferencia_alias !== null || d.transferencia_cbu !== null, {
    path: ["transferencia_alias"],
    message: "Para cobrar por transferencia poné el alias o el CBU",
  });

/** Item del carrito. */
const itemPedido = z.object({
  producto_id: z.uuid(),
  cantidad: z.number().int().min(1).max(20),
});

export const esquemaPedido = z.object({
  negocio_id: z.uuid(),
  /** El carrito, como JSON (`[{"producto_id": "...", "cantidad": 2}]`). */
  items: z.preprocess(
    (v) => {
      if (typeof v !== "string") return v;
      try {
        return JSON.parse(v);
      } catch {
        return null;
      }
    },
    z
      .array(itemPedido, { error: "El carrito está vacío" })
      .min(1, "El carrito está vacío")
      .max(20, "Máximo 20 productos distintos por pedido")
      .refine((its) => new Set(its.map((i) => i.producto_id)).size === its.length, "Hay un producto repetido"),
  ),
  nombre: texto(2, 80, "Tu nombre"),
  telefono,
  email: emailObligatorio,
  medio,
  turno_token: z.preprocess((v) => (v === "" || v === null ? undefined : v), token.optional()),
});
