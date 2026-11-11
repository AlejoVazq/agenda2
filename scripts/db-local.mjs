// Postgres 18 local para desarrollo, sin Docker ni instalar nada: corre los
// binarios del paquete embedded-postgres con los datos en .pgdata/.
//
//   npm run db:local     arranca (y la primera vez crea roles, base, tablas y seed)
//
// Queda corriendo en primer plano; Ctrl+C lo apaga. Los datos se conservan.
// URLs para .env.local (ver .env.example):
//   DATABASE_URL=postgres://agenda2_app:agenda2_app_local@127.0.0.1:54329/agenda2
//   DATABASE_URL_MIGRAR=postgres://agenda2_dueno:agenda2_dueno_local@127.0.0.1:54329/agenda2
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { migrar } from "../db/migrar.mjs";
import { sqlRoles } from "../db/roles.mjs";
import { cargarSeed } from "../db/seed.mjs";

const DIR = join(import.meta.dirname, "..", ".pgdata");
const PUERTO = 54329;
const CLAVES = { clave_dueno: "agenda2_dueno_local", clave_app: "agenda2_app_local" };
const URL_DUENO = `postgres://agenda2_dueno:${CLAVES.clave_dueno}@127.0.0.1:${PUERTO}/agenda2`;

const nuevo = !existsSync(join(DIR, "PG_VERSION"));
const servidor = new EmbeddedPostgres({
  databaseDir: DIR,
  user: "postgres",
  password: "postgres",
  port: PUERTO,
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: () => {},
});

if (nuevo) {
  console.log("Creando el Postgres local en .pgdata/ …");
  await servidor.initialise();
}
await servidor.start();

if (nuevo) {
  const admin = servidor.getPgClient();
  await admin.connect();
  const { roles, base } = sqlRoles(CLAVES);
  await admin.query(roles);
  // CREATE DATABASE no corre dentro de una transacción: de a una sentencia.
  for (const sentencia of base.split(/;\s*\n/).map((s) => s.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean)) {
    await admin.query(sentencia);
  }
  await admin.end();
  console.log("✓ roles y base agenda2");
}

// Migraciones pendientes (y el seed, la primera vez).
const dueno = new pg.Client({ connectionString: URL_DUENO });
await dueno.connect();
await migrar((sql, params) => dueno.query(sql, params));
if (nuevo) {
  await cargarSeed((sql, params) => dueno.query(sql, params));
  console.log("✓ datos demo (demo@turnos.test y barbero@turnos.test, contraseña demo1234)");
}
await dueno.end();

console.log(`\nPostgres local listo en 127.0.0.1:${PUERTO} (base agenda2). Ctrl+C para apagarlo.`);

let apagando = false;
async function apagar() {
  if (apagando) return;
  apagando = true;
  console.log("\nApagando Postgres…");
  await servidor.stop();
  process.exit(0);
}
process.on("SIGINT", apagar);
process.on("SIGTERM", apagar);
setInterval(() => {}, 1 << 30);
