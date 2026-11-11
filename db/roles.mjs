// Lee db/roles.sql (la fuente única de los roles) para desarrollo y pruebas,
// reemplazando las variables de psql (:'clave_dueno', :'clave_app').
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MARCA_BASE = "-- @base";

function literal(valor) {
  return `'${String(valor).replaceAll("'", "''")}'`;
}

/**
 * @param {{ clave_dueno: string, clave_app: string }} claves
 * @returns {{ roles: string, base: string }} `roles` crea los roles; `base`, la base y sus permisos.
 */
export function sqlRoles(claves) {
  const texto = readFileSync(join(import.meta.dirname, "roles.sql"), "utf8").replace(/\r\n/g, "\n");
  const conClaves = texto.replace(/:'([a-z_]+)'/g, (_, nombre) => {
    if (!(nombre in claves)) throw new Error(`Falta la variable ${nombre} para db/roles.sql`);
    return literal(claves[nombre]);
  });
  const corte = conClaves.indexOf(MARCA_BASE);
  if (corte < 0) throw new Error(`db/roles.sql no tiene la marca "${MARCA_BASE}"`);
  return { roles: conClaves.slice(0, corte), base: conClaves.slice(corte) };
}
