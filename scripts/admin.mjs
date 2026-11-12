// Administradores de la plataforma (acceso a /admin). Se corre en el servidor:
//
//   npm run admin -- listar
//   npm run admin -- agregar <mail>    (la cuenta tiene que existir y tener el mail confirmado)
//   npm run admin -- quitar <mail>
//   npm run admin -- quitar-2fa <mail>  (perdió el celular y los códigos de respaldo;
//                                        al entrar vuelve a configurar el segundo factor)
//
// Usa DATABASE_URL_MIGRAR (rol agenda2_dueno): ningún rol de la app puede tocar
// plataforma.administradores, ni siquiera un administrador desde la web.
import pg from "pg";

const url = process.env.DATABASE_URL_MIGRAR;
if (!url) {
  console.error("Falta DATABASE_URL_MIGRAR (conexión como agenda2_dueno). Ver .env.example.");
  process.exit(1);
}

const [accion, mail] = process.argv.slice(2);
if (!["listar", "agregar", "quitar", "quitar-2fa"].includes(accion) || (accion !== "listar" && !mail)) {
  console.error("Uso: npm run admin -- listar | agregar <mail> | quitar <mail> | quitar-2fa <mail>");
  process.exit(1);
}

const cliente = new pg.Client({ connectionString: url, application_name: "agenda2-admin" });
await cliente.connect();
try {
  if (accion === "listar") {
    const { rows } = await cliente.query(`
      select u."email", u."name", a.created_at from plataforma.administradores a
      join auth."user" u on u."id" = a.usuario_id order by a.created_at`);
    if (rows.length === 0) console.log("No hay administradores.");
    for (const r of rows) console.log(`${r.email}  (${r.name}, desde ${r.created_at.toISOString().slice(0, 10)})`);
  } else {
    const { rows } = await cliente.query(
      `select u."id", u."emailVerified", exists (select 1 from public.perfiles p where p.id = u."id") as tiene_negocio
       from auth."user" u where lower(u."email") = lower($1)`,
      [mail.trim()],
    );
    const u = rows[0];
    if (!u) throw new Error(`No hay ninguna cuenta con el mail ${mail}. Registrala primero en la web.`);
    if (accion === "agregar") {
      if (!u.emailVerified) throw new Error("La cuenta todavía no confirmó su mail.");
      if (u.tiene_negocio) {
        console.warn("Aviso: esta cuenta también es de un negocio. Conviene usar una cuenta solo para administrar.");
      }
      await cliente.query("insert into plataforma.administradores (usuario_id) values ($1) on conflict do nothing", [u.id]);
      console.log(`Listo: ${mail} es administrador. Al entrar va a tener que configurar el segundo factor.`);
    } else if (accion === "quitar-2fa") {
      await cliente.query("begin");
      await cliente.query('delete from auth."twoFactor" where "userId" = $1', [u.id]);
      await cliente.query('update auth."user" set "twoFactorEnabled" = false where "id" = $1', [u.id]);
      await cliente.query('delete from auth."session" where "userId" = $1', [u.id]);
      await cliente.query("commit");
      console.log(`Listo: se quitó el segundo factor de ${mail} y se cerraron sus sesiones. Al entrar lo configura de nuevo.`);
    } else {
      const { rowCount } = await cliente.query("delete from plataforma.administradores where usuario_id = $1", [u.id]);
      console.log(rowCount ? `Listo: ${mail} ya no es administrador.` : `${mail} no era administrador.`);
    }
  }
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exitCode = 1;
} finally {
  await cliente.end();
}
