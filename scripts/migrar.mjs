// Aplica las migraciones pendientes de db/migraciones/ (npm run db:migrar).
// Se conecta con DATABASE_URL_MIGRAR (rol agenda2_dueno), nunca con el de la app.
// En el servidor: cd /srv/agenda2/web && npm run db:migrar
import pg from "pg";
import { migrar } from "../db/migrar.mjs";

const url = process.env.DATABASE_URL_MIGRAR;
if (!url) {
  console.error("Falta DATABASE_URL_MIGRAR (conexión como agenda2_dueno). Ver .env.example.");
  process.exit(1);
}

const cliente = new pg.Client({ connectionString: url, application_name: "agenda2-migrar" });
await cliente.connect();
try {
  const hechas = await migrar((sql, params) => cliente.query(sql, params));
  console.log(hechas.length ? `Listo: ${hechas.length} migración(es) aplicada(s).` : "La base ya estaba al día.");
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exitCode = 1;
} finally {
  await cliente.end();
}
