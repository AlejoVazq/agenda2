import "server-only";
import { Pool, types as tiposPg, type PoolClient } from "pg";
import { env } from "@/lib/env";

// Capa de datos: Postgres directo con node-postgres, sin ORM.
//
// La app se conecta como agenda2_app (NOINHERIT): por sí sola no puede leer
// nada. Cada operación corre en una transacción que primero cambia de rol con
// SET LOCAL ROLE y, para el panel, fija el usuario con set_config(..., true).
// Así RLS decide qué filas ve cada uno, y si alguna consulta se escapara sin
// pasar por acá, la base la rechaza (falla cerrado).
//
//   comoUsuario(id, tx => ...)  usuario del panel (RLS)
//   comoAnonimo(tx => ...)      portal público: solo funciones públicas
//   comoServidor(tx => ...)     reservas, cron e integraciones (saltea RLS;
//                               usar solo después de verificar permisos)

// --- Consultas parametrizadas -----------------------------------------------------

/** Fragmento de SQL con sus valores. Solo se arma con la plantilla `sql`. */
export class Fragmento {
  constructor(
    readonly partes: readonly string[],
    readonly valores: readonly unknown[],
  ) {}
}

/**
 * Plantilla para SQL: cada `${valor}` se manda como parámetro ($1, $2, ...),
 * nunca concatenado. Un `${otroFragmento}` se inserta tal cual, con sus valores.
 *
 *   sql`select * from turnos where id = ${id} ${soloActivos ? sql`and estado <> 'cancelado'` : sql``}`
 */
export function sql(partes: TemplateStringsArray, ...valores: unknown[]): Fragmento {
  return new Fragmento([...partes], valores);
}

/** Une fragmentos con un separador (por ejemplo, columnas de un update). */
sql.unir = (fragmentos: Fragmento[], separador = ", "): Fragmento => {
  if (fragmentos.length === 0) return sql``;
  const partes: string[] = [""];
  const valores: unknown[] = [];
  fragmentos.forEach((f, i) => {
    if (i > 0) partes[partes.length - 1] += separador;
    valores.push(f);
    partes.push("");
  });
  return new Fragmento(partes, valores);
};

export function compilar(f: Fragmento): { text: string; values: unknown[] } {
  let text = "";
  const values: unknown[] = [];
  const visitar = (fr: Fragmento) => {
    fr.partes.forEach((parte, i) => {
      text += parte;
      if (i >= fr.valores.length) return;
      const v = fr.valores[i];
      if (v instanceof Fragmento) {
        visitar(v);
      } else {
        values.push(v === undefined ? null : v);
        text += `$${values.length}`;
      }
    });
  };
  visitar(f);
  return { text, values };
}

// --- Tipos: mismos formatos que devolvía PostgREST ---------------------------------
// Solo para el pool de la app (Better Auth usa el suyo, con Date nativos).
const tipos = {
  getTypeParser(oid: number, formato?: "text" | "binary") {
    switch (oid) {
      case 1184: // timestamptz → ISO 8601 conservando los microsegundos
        return (v: string) => v.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00");
      case 1114: // timestamp sin zona (no se usa en el esquema)
        return (v: string) => v.replace(" ", "T");
      case 1082: // date → "YYYY-MM-DD"
        return (v: string) => v;
      case 1700: // numeric → number (precios con 2 decimales)
      case 20: //   int8 (count) → number
        return (v: string) => Number(v);
      default:
        return tiposPg.getTypeParser(oid, formato);
    }
  },
} as unknown as typeof tiposPg;

// --- Pool -------------------------------------------------------------------------

const global = globalThis as unknown as { __agenda2Pool?: Pool };

function pool(): Pool {
  if (!global.__agenda2Pool) {
    if (!env.databaseUrl) throw new Error("Falta DATABASE_URL en el entorno del servidor (ver .env.example).");
    global.__agenda2Pool = new Pool({
      connectionString: env.databaseUrl,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      application_name: "agenda2",
      // Fechas siempre en UTC: se muestran en la zona del negocio (src/lib/fechas.ts).
      options: "-c TimeZone=UTC",
      types: tipos,
    });
    global.__agenda2Pool.on("error", (e) => console.error("[db] error en una conexión inactiva", e));
  }
  return global.__agenda2Pool;
}

// --- Transacciones con rol ----------------------------------------------------------

export type Tx = {
  /** Todas las filas. */
  varios<T = Record<string, unknown>>(consulta: Fragmento): Promise<T[]>;
  /** La primera fila, o null. */
  uno<T = Record<string, unknown>>(consulta: Fragmento): Promise<T | null>;
  /** Cantidad de filas afectadas. */
  ejecutar(consulta: Fragmento): Promise<number>;
};

function crearTx(cliente: PoolClient): Tx {
  // Una conexión corre una consulta por vez: se encadenan, así se puede usar
  // Promise.all dentro de una transacción sin encolar en el cliente de pg.
  let cola: Promise<unknown> = Promise.resolve();
  const correr = (f: Fragmento) => {
    const { text, values } = compilar(f);
    const resultado = cola.then(() => cliente.query(text, values));
    cola = resultado.catch(() => null);
    return resultado;
  };
  return {
    async varios<T>(f: Fragmento) {
      return (await correr(f)).rows as T[];
    },
    async uno<T>(f: Fragmento) {
      return ((await correr(f)).rows[0] as T | undefined) ?? null;
    },
    async ejecutar(f: Fragmento) {
      return (await correr(f)).rowCount ?? 0;
    },
  };
}

type Rol = "agenda2_usuario" | "agenda2_anonimo" | "agenda2_servidor";

async function enTransaccion<T>(rol: Rol, usuarioId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const cliente = await pool().connect();
  let roto: Error | undefined;
  try {
    await cliente.query("begin");
    // `rol` sale de un conjunto fijo (tipo Rol): no viene del usuario.
    await cliente.query(`set local role ${rol}`);
    if (usuarioId) await cliente.query("select set_config('app.usuario_id', $1, true)", [usuarioId]);
    const resultado = await fn(crearTx(cliente));
    await cliente.query("commit");
    return resultado;
  } catch (e) {
    try {
      await cliente.query("rollback");
    } catch (errorRollback) {
      // La conexión quedó inutilizable: que el pool la descarte.
      roto = errorRollback as Error;
    }
    throw e;
  } finally {
    cliente.release(roto);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Consultas de un usuario del panel: RLS limita a su negocio y su rol. */
export function comoUsuario<T>(usuarioId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID.test(usuarioId)) throw new Error("usuarioId inválido");
  return enTransaccion("agenda2_usuario", usuarioId, fn);
}

/** Portal público: solo puede ejecutar las funciones públicas de la base. */
export function comoAnonimo<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return enTransaccion("agenda2_anonimo", null, fn);
}

/**
 * Tareas del servidor: saltea RLS. Usar solo con consultas fijas, después de
 * verificar que quien pide tiene permiso (o desde el cron y los webhooks).
 */
export function comoServidor<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return enTransaccion("agenda2_servidor", null, fn);
}

/** ¿Es un error de Postgres? Para leer su código (23505, P0001, ...). */
export function esErrorPg(e: unknown): e is { code: string; message: string; constraint?: string } {
  return typeof e === "object" && e !== null && "code" in e && typeof (e as { code: unknown }).code === "string";
}
