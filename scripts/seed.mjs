// Datos demo para desarrollo (npm run db:seed y npm run db:reset).
//   npm run db:seed    carga el seed en una base vacía (recién migrada)
//   npm run db:reset   BORRA todo, vuelve a migrar y carga el seed
// Nunca en producción.
import pg from "pg";
import { migrar } from "../db/migrar.mjs";
import { cargarSeed } from "../db/seed.mjs";

if (process.env.NODE_ENV === "production") {
  console.error("El seed es solo para desarrollo.");
  process.exit(1);
}
const url = process.env.DATABASE_URL_MIGRAR;
if (!url) {
  console.error("Falta DATABASE_URL_MIGRAR (conexión como agenda2_dueno). Ver .env.example.");
  process.exit(1);
}
const host = new URL(url).hostname;
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  console.error(`El seed solo corre contra una base local (DATABASE_URL_MIGRAR apunta a ${host}).`);
  process.exit(1);
}

const cliente = new pg.Client({ connectionString: url });
await cliente.connect();
const ejecutar = (sql, params) => cliente.query(sql, params);
try {
  if (process.argv.includes("--reset")) {
    await ejecutar(`
      drop schema if exists plataforma cascade;
      drop schema if exists auth cascade;
      drop schema if exists app cascade;
      drop schema if exists extensions cascade;
      drop schema if exists public cascade;
      create schema public;`);
    console.log("✓ base vaciada");
    await migrar(ejecutar);
  }
  await cargarSeed(ejecutar);
  console.log("✓ datos demo: demo@turnos.test y barbero@turnos.test; admin: admin@turnos.test (contraseña demo1234)");
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exitCode = 1;
} finally {
  await cliente.end();
}
