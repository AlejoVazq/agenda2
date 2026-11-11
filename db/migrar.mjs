// Migraciones propias: aplica en orden los archivos de db/migraciones/ que no se
// aplicaron todavía y deja registro en app.schema_version.
//
// Reglas:
// - Cada archivo es NNNN_nombre.sql y corre en su propia transacción.
// - Una migración aplicada NUNCA se edita: se guarda su checksum y, si el archivo
//   cambia, se corta con error. Los cambios van en una migración nueva.
// - Un candado (advisory lock) evita que dos procesos migren a la vez.
//
// Lo usan scripts/migrar.mjs (producción y desarrollo) y scripts/test-db.mjs
// (PGlite). `ejecutar(sql, params)` debe devolver { rows }.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const CARPETA_MIGRACIONES = join(import.meta.dirname, "migraciones");
const CANDADO = 7_120_045_311; // número arbitrario y fijo para pg_advisory_lock

export function leerMigraciones(carpeta = CARPETA_MIGRACIONES) {
  return readdirSync(carpeta)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((archivo) => {
      const coincide = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(archivo);
      if (!coincide) throw new Error(`Nombre de migración inválido: ${archivo} (se espera NNNN_nombre.sql)`);
      const sql = readFileSync(join(carpeta, archivo), "utf8").replace(/\r\n/g, "\n");
      return {
        version: Number(coincide[1]),
        nombre: archivo,
        sql,
        checksum: createHash("sha256").update(sql).digest("hex"),
      };
    });
}

/**
 * @param {(sql: string, params?: unknown[]) => Promise<{ rows: any[] }>} ejecutar
 * @param {{ carpeta?: string, log?: (msg: string) => void }} [opciones]
 * @returns {Promise<string[]>} nombres de las migraciones aplicadas en esta corrida
 */
export async function migrar(ejecutar, { carpeta, log = console.log } = {}) {
  const migraciones = leerMigraciones(carpeta);
  const versiones = new Set();
  for (const m of migraciones) {
    if (versiones.has(m.version)) throw new Error(`Versión de migración repetida: ${m.version}`);
    versiones.add(m.version);
  }

  await ejecutar("select pg_advisory_lock($1)", [CANDADO]);
  try {
    await ejecutar(`
      create schema if not exists app;
      create table if not exists app.schema_version (
        version    integer primary key,
        nombre     text not null,
        checksum   text not null,
        aplicada_at timestamptz not null default now()
      );
    `);
    const { rows } = await ejecutar("select version, nombre, checksum from app.schema_version order by version");
    const aplicadas = new Map(rows.map((r) => [Number(r.version), r]));

    for (const [version, fila] of aplicadas) {
      const m = migraciones.find((x) => x.version === version);
      if (!m) throw new Error(`La base tiene la migración ${fila.nombre}, que no está en ${carpeta ?? "db/migraciones"}.`);
      if (m.checksum !== fila.checksum) {
        throw new Error(
          `La migración ${m.nombre} cambió después de aplicarse. No se editan migraciones aplicadas: creá una nueva.`,
        );
      }
    }

    const hechas = [];
    for (const m of migraciones) {
      if (aplicadas.has(m.version)) continue;
      await ejecutar("begin");
      try {
        await ejecutar(m.sql);
        await ejecutar("insert into app.schema_version (version, nombre, checksum) values ($1, $2, $3)", [
          m.version,
          m.nombre,
          m.checksum,
        ]);
        await ejecutar("commit");
      } catch (e) {
        await ejecutar("rollback");
        throw new Error(`Falló la migración ${m.nombre}: ${e.message}`, { cause: e });
      }
      log(`✓ migración ${m.nombre}`);
      hechas.push(m.nombre);
    }
    return hechas;
  } finally {
    await ejecutar("select pg_advisory_unlock($1)", [CANDADO]);
  }
}
