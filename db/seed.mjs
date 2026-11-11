// Carga los datos demo (db/seed.sql) y sus usuarios. Los usuarios se crean acá
// y no en el SQL porque la contraseña la cifra Better Auth (scrypt).
// Lo usan scripts/seed.mjs y scripts/test-db.mjs.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hashPassword } from "better-auth/crypto";

export const USUARIOS_DEMO = [
  { id: "11111111-1111-4111-8111-111111111111", nombre: "Sofía", email: "demo@turnos.test" },
  { id: "11111111-1111-4111-8111-111111111112", nombre: "Mateo", email: "barbero@turnos.test" },
];
export const CLAVE_DEMO = "demo1234";

/**
 * @param {(sql: string, params?: unknown[]) => Promise<unknown>} ejecutar
 *   Corre como dueño de la base (o superusuario).
 */
export async function cargarSeed(ejecutar) {
  const hash = await hashPassword(CLAVE_DEMO);
  await ejecutar("begin");
  try {
    for (const u of USUARIOS_DEMO) {
      await ejecutar(
        `insert into auth."user" ("id", "name", "email", "emailVerified") values ($1, $2, $3, true)`,
        [u.id, u.nombre, u.email],
      );
      await ejecutar(
        `insert into auth."account" ("accountId", "providerId", "userId", "password", "updatedAt")
         values ($1::text, 'credential', $1::uuid, $2, now())`,
        [u.id, hash],
      );
    }
    await ejecutar(readFileSync(join(import.meta.dirname, "seed.sql"), "utf8"));
    await ejecutar("commit");
  } catch (e) {
    await ejecutar("rollback");
    throw e;
  }
}
