// Prueba las migraciones, los roles y RLS contra un Postgres embebido (PGlite), sin Docker.
// Usa los mismos archivos que producción: db/roles.sql, db/migraciones/ (con el
// mismo migrador) y db/seed.sql. Las migraciones corren como agenda2_dueno.
//
// Uso: npm run test:db
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { mkdtempSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { verifyPassword } from "better-auth/crypto";
import { migrar, CARPETA_MIGRACIONES } from "../db/migrar.mjs";
import { sqlRoles } from "../db/roles.mjs";
import { cargarSeed, USUARIOS_DEMO, CLAVE_DEMO } from "../db/seed.mjs";

/** Base nueva con los roles de db/roles.sql y las migraciones aplicadas. */
async function baseNueva({ carpeta } = {}) {
  const db = new PGlite({ extensions: { btree_gist } });
  const { roles } = sqlRoles({ clave_dueno: "x", clave_app: "x" });
  await db.exec(roles);
  // En producción agenda2_dueno es dueño de la base (y por eso del esquema public).
  await db.exec(`
    grant create on database ${(await db.query("select current_database() as d")).rows[0].d} to agenda2_dueno;
    alter schema public owner to agenda2_dueno;
  `);
  const ejecutar = ejecutor(db);
  await db.exec("set role agenda2_dueno");
  await migrar(ejecutar, { carpeta, log: (m) => console.log(m) });
  await db.exec("reset role");
  return { db, ejecutar };
}

function ejecutor(db) {
  return async (sql, params) => (params ? db.query(sql, params) : { rows: (await db.exec(sql)).at(-1)?.rows ?? [] });
}

const { db } = await baseNueva();

// --- helpers --------------------------------------------------------------------
const USUARIOS = {
  ana: "00000000-0000-4000-8000-00000000000a", // dueña negocio A
  beto: "00000000-0000-4000-8000-00000000000b", // dueño negocio B
  eva: "00000000-0000-4000-8000-00000000000e", // empleada negocio A
  nadie: "00000000-0000-4000-8000-0000000000ff", // registrado sin negocio
  admin: "00000000-0000-4000-8000-0000000000ad", // administrador de la plataforma
};
for (const [nombre, id] of Object.entries(USUARIOS)) {
  await db.query(`insert into auth."user" ("id", "name", "email", "emailVerified") values ($1, $2, $3, true)`, [
    id,
    nombre,
    `${nombre}@test.com`,
  ]);
}

// Como lo hace `npm run admin -- agregar`: con el dueño de la base.
await db.query("insert into plataforma.administradores (usuario_id) values ($1)", [USUARIOS.admin]);

const ROLES = { anon: "agenda2_anonimo", servidor: "agenda2_servidor", app: "agenda2_app", auth: "agenda2_auth" };

/** Corre fn como lo hace src/lib/db: un usuario del panel, el visitante anónimo o el servidor. */
async function como(usuario, fn) {
  await db.exec("reset role");
  if (usuario in ROLES) {
    await db.query("select set_config('app.usuario_id', '', false)");
    await db.exec(`set role ${ROLES[usuario]}`);
  } else if (usuario) {
    await db.query("select set_config('app.usuario_id', $1, false)", [USUARIOS[usuario]]);
    await db.exec("set role agenda2_usuario");
  }
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('app.usuario_id', '', false)");
  }
}
const q = async (sql, params) => (await db.query(sql, params)).rows;
const uno = async (sql, params) => (await q(sql, params))[0];
const servicio = (sql, params) => como("servidor", () => q(sql, params));

async function falla(promesa, patron, descripcion) {
  try {
    await promesa;
  } catch (e) {
    if (patron && !patron.test(e.message)) {
      throw new Error(`${descripcion}: falló con un error inesperado: ${e.message}`);
    }
    return;
  }
  throw new Error(`${descripcion}: se esperaba un error y no lo hubo`);
}

let pruebas = 0;
async function prueba(nombre, fn) {
  try {
    await fn();
    pruebas++;
    console.log(`  ✓ ${nombre}`);
  } catch (e) {
    console.error(`  ✗ ${nombre}\n    ${e.stack}`);
    process.exit(1);
  }
}

// Próximo lunes (fecha local de Buenos Aires), al menos 2 días adelante.
const { lunes } = await uno(`
  select (d + ((8 - extract(isodow from d)::int) % 7) * interval '1 day')::date::text as lunes
  from (select ((now() at time zone 'America/Argentina/Buenos_Aires')::date + 2) as d) x
`);

console.log("\nPruebas:");

// --- Roles y permisos generales ----------------------------------------------------

await prueba("roles: agenda2_app no puede leer nada sin cambiar de rol (falla cerrado)", async () => {
  await como("app", async () => {
    for (const t of [
      "public.negocios", "public.turnos", "public.clientes", 'auth."user"', 'auth."account"', "app.schema_version",
      "plataforma.administradores", "plataforma.pagos",
    ]) {
      await falla(q(`select * from ${t}`), /permission denied/, t);
    }
    await falla(q("select public.negocio_publico('x')"), /permission denied/, "función pública");
  });
  // Puede pasar a cada rol de la app, pero no hereda sus permisos.
  for (const rol of ["agenda2_usuario", "agenda2_anonimo", "agenda2_servidor", "agenda2_auth"]) {
    const r = await uno("select pg_has_role('agenda2_app', $1, 'SET') as set, pg_has_role('agenda2_app', $1, 'USAGE') as usage", [rol]);
    assert.deepEqual({ ...r }, { set: true, usage: false }, rol);
  }
  const { super: esSuper } = await uno("select rolsuper as super from pg_roles where rolname = 'agenda2_dueno'");
  assert.equal(esSuper, false);
});

await prueba("anon: solo ejecuta las 5 funciones del portal público", async () => {
  const filas = await q(`
    select p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app', 'auth', 'plataforma') and has_function_privilege('agenda2_anonimo', p.oid, 'execute')
      -- Los constructores del tipo rango_hora (los crea Postgres, ejecutables por todos)
      -- solo arman un rango de horas: no leen ni escriben nada.
      and not exists (select 1 from pg_type t where t.typname = p.proname and t.typnamespace = p.pronamespace)
    order by 1`);
  assert.deepEqual(
    filas.map((f) => f.proname),
    ["cancelar_turno_cliente", "dias_disponibles", "horarios_libres", "negocio_publico", "ver_turno"],
  );
});

await prueba("anon: sin permisos sobre ninguna tabla de ningún esquema", async () => {
  const filas = await q(`
    select c.oid::regclass::text as tabla
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'v', 'm', 'p') and n.nspname in ('public', 'app', 'auth')
      and (has_table_privilege('agenda2_anonimo', c.oid, 'select, insert, update, delete')
           or has_any_column_privilege('agenda2_anonimo', c.oid, 'select, insert, update'))`);
  assert.deepEqual(filas, []);
});

await prueba("crear_reserva y las tareas del cron: solo el servidor", async () => {
  const soloServidor = [
    "crear_reserva", "consumir_limite", "vencer_pagos_pendientes", "registrar_pago", "reclamar_recordatorios",
    "reclamar_recordatorios_whatsapp", "turnos_para_sincronizar", "marcar_sincronizado_google", "reemplazar_bloqueos_google",
    "dejar_resena", "reclamar_pedidos_resena", "dejar_resena_libre",
    "crear_pedido", "ver_pedido", "cancelar_pedido_cliente", "registrar_pago_pedido", "liberar_pedidos_vencidos",
  ];
  const filas = await q(
    `select p.proname,
            has_function_privilege('agenda2_usuario', p.oid, 'execute') as usuario,
            has_function_privilege('agenda2_anonimo', p.oid, 'execute') as anonimo,
            has_function_privilege('agenda2_servidor', p.oid, 'execute') as servidor
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any($1)`,
    [soloServidor],
  );
  assert.equal(filas.length, soloServidor.length);
  for (const f of filas) assert.deepEqual({ ...f }, { proname: f.proname, usuario: false, anonimo: false, servidor: true });
});

await prueba("auth: Better Auth solo ve su esquema; el resto no lee contraseñas ni sesiones", async () => {
  await como("auth", async () => {
    await q('select * from auth."user"');
    await q('select * from auth."account"');
    await q('select * from auth."twoFactor"');
    await falla(q("select * from public.negocios"), /permission denied/, "auth en public");
  });
  // Los secretos del segundo factor: solo Better Auth.
  for (const u of ["ana", "anon", "servidor", "admin"]) {
    await como(u, () => falla(q('select * from auth."twoFactor"'), /permission denied/, `${u} lee secretos 2FA`));
  }
  for (const u of ["ana", "anon"]) {
    await como(u, () => falla(q('select * from auth."user"'), /permission denied/, `${u} lee usuarios`));
  }
  await como("servidor", async () => {
    assert.ok((await q('select "email" from auth."user"')).length >= 4);
    await falla(q('select "password" from auth."account"'), /permission denied/, "servidor lee contraseñas");
    await falla(q('select "token" from auth."session"'), /permission denied/, "servidor lee sesiones");
    await falla(q('update auth."user" set "email" = \'x@x.com\''), /permission denied/, "servidor cambia mails");
  });
});

// --- Onboarding y configuración -----------------------------------------------------

let negA, negB, servA, profAna, profEva;

await prueba("onboarding: crear_negocio crea negocio + perfil de dueña + profesional", async () => {
  negA = await como("ana", async () =>
    (await uno("select public.crear_negocio('Salón Ana', 'salon-ana', 'otro', 'Ana', null, null, true) as id")).id,
  );
  const perfil = await uno("select * from public.perfiles where id = $1", [USUARIOS.ana]);
  assert.equal(perfil.rol, "dueno");
  assert.equal(perfil.negocio_id, negA);
  assert.ok(perfil.profesional_id);
  profAna = perfil.profesional_id;
});

await prueba("onboarding: sin usuario en la transacción no se crea nada", async () => {
  await como("servidor", () => falla(q("select public.crear_negocio('X', 'xxx-sin', 'otro', 'X')"), /permission denied/, "servidor"));
  await db.exec("set role agenda2_usuario");
  try {
    await falla(q("select public.crear_negocio('X', 'xxx-sin', 'otro', 'X')"), /NO_AUTENTICADO/, "sin app.usuario_id");
  } finally {
    await db.exec("reset role");
  }
});

await prueba("onboarding: no se puede crear un segundo negocio", async () => {
  await como("ana", () =>
    falla(q("select public.crear_negocio('Otro', 'otro-ana', 'otro', 'Ana')"), /YA_TIENE_NEGOCIO/, "segundo negocio"),
  );
});

await prueba("onboarding: slug ocupado e inválido", async () => {
  await como("beto", () =>
    falla(q("select public.crear_negocio('X', 'salon-ana', 'otro', 'Beto')"), /SLUG_OCUPADO/, "slug ocupado"),
  );
  await como("beto", () => falla(q("select public.crear_negocio('X', 'Mal Slug!', 'otro', 'Beto')"), null, "slug inválido"));
  negB = await como("beto", async () =>
    (await uno("select public.crear_negocio('Barbería Beto', 'barberia-beto', 'otro', 'Beto') as id")).id,
  );
});

await prueba("dueña: ABM de servicios y profesionales en su negocio", async () => {
  await como("ana", async () => {
    servA = (
      await uno(
        "insert into public.servicios (negocio_id, nombre, duracion_min, precio) values ($1, 'Corte', 60, 8000) returning id",
        [negA],
      )
    ).id;
    profEva = (
      await uno("insert into public.profesionales (negocio_id, nombre) values ($1, 'Eva') returning id", [negA])
    ).id;
    await q("select public.guardar_servicios_profesional($1, array[$2]::uuid[])", [profAna, servA]);
    await q("select public.guardar_servicios_profesional($1, array[$2]::uuid[])", [profEva, servA]);
    const franjas = JSON.stringify([
      { dia_semana: 1, desde: "09:00", hasta: "13:00" },
      { dia_semana: 1, desde: "14:00", hasta: "18:00" },
    ]);
    await q("select public.guardar_horarios($1, $2::jsonb)", [profAna, franjas]);
    await q("select public.guardar_horarios($1, $2::jsonb)", [profEva, franjas]);
    const { n } = await uno("select count(*)::int as n from public.horarios_profesional");
    assert.equal(n, 4);
  });
});

await prueba("horarios: franjas superpuestas se rechazan", async () => {
  await como("ana", () =>
    falla(
      q("select public.guardar_horarios($1, $2::jsonb)", [
        profAna,
        JSON.stringify([
          { dia_semana: 2, desde: "09:00", hasta: "13:00" },
          { dia_semana: 2, desde: "12:00", hasta: "15:00" },
        ]),
      ]),
      /conflicting key|exclusion/,
      "franjas superpuestas",
    ),
  );
});

await prueba("aislamiento: Beto no ve ni modifica datos del negocio de Ana", async () => {
  await como("beto", async () => {
    assert.equal((await q("select * from public.servicios")).length, 0);
    assert.equal((await q("select * from public.profesionales")).length, 1); // solo el suyo
    assert.equal((await q("select * from public.negocios")).length, 1);
    assert.equal((await q("select * from public.perfiles")).length, 1);
    await falla(
      q("insert into public.servicios (negocio_id, nombre, duracion_min) values ($1, 'Hack', 30)", [negA]),
      /row-level security/,
      "insert en negocio ajeno",
    );
    const upd = await db.query("update public.servicios set precio = 1 where id = $1", [servA]);
    assert.equal(upd.affectedRows, 0);
    await falla(q("select public.guardar_horarios($1, '[]'::jsonb)", [profAna]), /SIN_PERMISO/, "horarios ajenos");
    await falla(
      q("select public.guardar_servicios_profesional($1, '{}'::uuid[])", [profAna]),
      /SIN_PERMISO/,
      "servicios ajenos",
    );
  });
});

await prueba("aislamiento: usuario sin negocio no ve nada", async () => {
  await como("nadie", async () => {
    for (const t of ["negocios", "perfiles", "servicios", "profesionales", "turnos", "clientes", "bloqueos", "integraciones"]) {
      assert.equal((await q(`select * from public.${t}`)).length, 0, t);
    }
  });
});

await prueba("anon: sin acceso directo a tablas", async () => {
  await como("anon", async () => {
    for (const t of ["negocios", "servicios", "turnos", "clientes", "perfiles", "accesos", "limites_uso"]) {
      await falla(q(`select * from public.${t}`), /permission denied/, `select ${t}`);
    }
    await falla(q("select public.crear_negocio('X', 'xxx', 'otro', 'X')"), /permission denied/, "crear_negocio");
  });
});

await prueba("público: negocio_publico devuelve solo datos públicos", async () => {
  const data = await como("anon", async () => (await uno("select public.negocio_publico('salon-ana') as d")).d);
  assert.equal(data.nombre, "Salón Ana");
  assert.equal(data.servicios.length, 1);
  assert.equal(data.servicios[0].profesional_ids.length, 2);
  assert.equal(data.profesionales.length, 2);
  assert.ok(!("email" in data.profesionales[0]));
  const nada = await como("anon", async () => (await uno("select public.negocio_publico('no-existe') as d")).d);
  assert.equal(nada, null);
});

await prueba("servicio de emergencia: aparte en el portal y sin horarios", async () => {
  const publico = async () => (await como("anon", () => uno("select public.negocio_publico('salon-ana') as d"))).d;
  await como("ana", () =>
    falla(
      q("insert into public.servicios (negocio_id, nombre, duracion_min, emergencia) values ($1, 'Sin número', 60, true)", [negA]),
      /servicios_emergencia_contacto/,
      "el de emergencia exige WhatsApp",
    ),
  );
  const urg = await como("ana", async () => {
    const s = await uno(
      `insert into public.servicios (negocio_id, nombre, duracion_min, precio, emergencia, contacto_whatsapp)
       values ($1, 'Urgencia', 60, 20000, true, '2478451234') returning id`,
      [negA],
    );
    await q("insert into public.profesional_servicio (negocio_id, profesional_id, servicio_id) values ($1, $2, $3)", [negA, profAna, s.id]);
    return s.id;
  });

  let data = await publico();
  assert.equal(data.servicios.length, 1, "el de emergencia no va en servicios");
  assert.equal(data.emergencias.length, 1);
  assert.equal(data.emergencias[0].nombre, "Urgencia");
  assert.equal(Number(data.emergencias[0].precio), 20000);
  assert.equal(data.emergencias[0].whatsapp, "2478451234", "el número de quien lo atiende");
  assert.ok(!("duracion_min" in data.emergencias[0]));

  const libres = await como("anon", () => q("select * from public.horarios_libres($1, $2, $3::date, $4)", [negA, urg, lunes, profAna]));
  assert.equal(libres.length, 0, "sin horarios");
  const inicio = (await uno("select (($1::date + time '10:00') at time zone 'America/Argentina/Buenos_Aires') as t", [lunes])).t;
  await falla(
    como("servidor", () =>
      q("select * from public.crear_reserva($1, $2, $3, $4, 'Leo', '1144443333', 'leo@mail.com')", [negA, urg, profAna, inicio]),
    ),
    /HORARIO_NO_DISPONIBLE/,
    "no se reserva online",
  );

  await como("ana", () => falla(q("update public.servicios set contacto_whatsapp = null where id = $1", [urg]), /servicios_emergencia_contacto/, "no se borra el número"));
  await como("ana", () => falla(q("update public.servicios set contacto_whatsapp = '12' where id = $1", [urg]), /check/, "número inválido"));

  await como("ana", () => q("update public.servicios set emergencia = false, contacto_whatsapp = null where id = $1", [urg]));
  data = await publico();
  assert.equal(data.servicios.length, 2, "desmarcado vuelve al flujo normal");
  assert.equal(data.emergencias.length, 0);
  const ahora = await como("anon", () => q("select * from public.horarios_libres($1, $2, $3::date, $4)", [negA, urg, lunes, profAna]));
  assert.ok(ahora.length > 0);

  await como("ana", () => q("delete from public.servicios where id = $1", [urg]));
});

await prueba("disponibilidad: horarios libres del lunes (2 franjas, 60 min cada 15)", async () => {
  const slots = await como("anon", () =>
    q("select * from public.horarios_libres($1, $2, $3::date, $4)", [negA, servA, lunes, profAna]),
  );
  // 09:00..12:00 = 13 inicios, 14:00..17:00 = 13 inicios
  assert.equal(slots.length, 26);
  const primero = await uno("select to_char($1::timestamptz at time zone 'America/Argentina/Buenos_Aires', 'HH24:MI') as h", [
    slots[0].inicio,
  ]);
  assert.equal(primero.h, "09:00");
  const todos = await como("anon", () => q("select * from public.horarios_libres($1, $2, $3::date)", [negA, servA, lunes]));
  assert.equal(todos.length, 52);
  const martes = await como("anon", () =>
    q("select * from public.horarios_libres($1, $2, ($3::date + 1), null)", [negA, servA, lunes]),
  );
  assert.equal(martes.length, 0);
});

await prueba("disponibilidad: fuera de la anticipación máxima no hay horarios", async () => {
  const lejos = await como("anon", () =>
    q("select * from public.horarios_libres($1, $2, ($3::date + 70), null)", [negA, servA, lunes]),
  );
  assert.equal(lejos.length, 0);
});

// --- Reservas ----------------------------------------------------------------------

await prueba("reserva: crear_reserva solo desde el servidor", async () => {
  for (const u of ["anon", "ana"]) {
    await como(u, () =>
      falla(q("select * from public.crear_reserva($1, $2, null, now(), 'X', '1', 'x@x.com')", [negA, servA]), /permission denied/, u),
    );
  }
});

/** Reserva online tal como la hace la app: con el rol del servidor. */
const reservar = (sql, params) => como("servidor", () => uno(sql, params));

let token1, inicio10;
await prueba("reserva: crear_reserva sin cuenta devuelve token", async () => {
  inicio10 = (await uno("select (($1::date + time '10:00') at time zone 'America/Argentina/Buenos_Aires') as t", [lunes])).t;
  const r = await reservar("select * from public.crear_reserva($1, $2, $3, $4, 'Lucía', '+54 9 11 5555-1234', 'lucia@mail.com')", [
    negA,
    servA,
    profAna,
    inicio10,
  ]);
  assert.match(r.token, /^[0-9a-f]{64}$/);
  token1 = r.token;
  const turno = await uno("select * from public.turnos where id = $1", [r.turno_id]);
  assert.equal(turno.estado, "confirmado");
  assert.equal(Number(turno.precio), 8000);
  assert.deepEqual(
    [turno.nombre_reserva, turno.email_reserva, turno.telefono_reserva],
    ["Lucía", "lucia@mail.com", "1155551234"],
  );
  const cli = await uno("select * from public.clientes where id = $1", [turno.cliente_id]);
  assert.equal(cli.telefono, "1155551234");
});

await prueba("reserva: mismo horario y profesional se rechaza; con 'cualquiera' se asigna a otra", async () => {
  await falla(
    reservar("select * from public.crear_reserva($1, $2, $3, $4, 'Otro', '1144445555', 'otro@mail.com')", [negA, servA, profAna, inicio10]),
    /HORARIO_NO_DISPONIBLE/,
    "duplicado",
  );
  const r = await reservar("select * from public.crear_reserva($1, $2, null, $3, 'Otro', '1144445555', 'otro@mail.com')", [
    negA,
    servA,
    inicio10,
  ]);
  const t = await uno("select profesional_id from public.turnos where id = $1", [r.turno_id]);
  assert.equal(t.profesional_id, profEva);
  await falla(
    reservar("select * from public.crear_reserva($1, $2, null, $3, 'Tercero', '1144446666', 'tercero@mail.com')", [negA, servA, inicio10]),
    /HORARIO_NO_DISPONIBLE/,
    "sin profesionales libres",
  );
});

await prueba("reserva: horarios superpuestos ya no aparecen como libres", async () => {
  const slots = await como("anon", () =>
    q("select * from public.horarios_libres($1, $2, $3::date, $4)", [negA, servA, lunes, profAna]),
  );
  // 10:00-11:00 ocupado => se pierden 09:15, 09:30, 09:45, 10:00, 10:15, 10:30, 10:45
  assert.equal(slots.length, 26 - 7);
});

await prueba("reserva: horario fuera de agenda o datos inválidos se rechazan", async () => {
  const fuera = (await uno("select (($1::date + time '20:00') at time zone 'America/Argentina/Buenos_Aires') as t", [lunes])).t;
  await falla(
    reservar("select * from public.crear_reserva($1, $2, null, $3, 'Juan', '1144447777', 'juan@mail.com')", [negA, servA, fuera]),
    /HORARIO_NO_DISPONIBLE/,
    "fuera de agenda",
  );
  await falla(
    reservar("select * from public.crear_reserva($1, $2, null, $3, 'J', '12', 'no-es-mail')", [negA, servA, inicio10]),
    /DATOS_INVALIDOS/,
    "datos inválidos",
  );
});

await prueba("restricción de exclusión: inserción directa superpuesta falla", async () => {
  const t = await uno("select * from public.turnos where token_cancelacion = $1", [token1]);
  await falla(
    q(
      `insert into public.turnos (negocio_id, profesional_id, servicio_id, cliente_id, inicio, fin)
       values ($1, $2, $3, $4, $5::timestamptz + interval '30 minutes', $6::timestamptz + interval '30 minutes')`,
      [t.negocio_id, t.profesional_id, t.servicio_id, t.cliente_id, t.inicio, t.fin],
    ),
    /turnos_sin_superposicion/,
    "superposición",
  );
});

await prueba("token: ver_turno y cancelar_turno_cliente", async () => {
  const d = await como("anon", async () => (await uno("select public.ver_turno($1) as d", [token1])).d);
  assert.equal(d.servicio, "Corte");
  assert.equal(d.puede_cancelar, true);
  assert.equal(await como("anon", async () => (await uno("select public.ver_turno($1) as d", ["0".repeat(64)])).d), null);
  await como("anon", () => q("select public.cancelar_turno_cliente($1)", [token1]));
  const t = await uno("select estado, cancelado_por from public.turnos where token_cancelacion = $1", [token1]);
  assert.equal(t.estado, "cancelado");
  assert.equal(t.cancelado_por, "cliente");
  await como("anon", () => falla(q("select public.cancelar_turno_cliente($1)", [token1]), /NO_CANCELABLE/, "doble"));
  // El horario se libera
  const slots = await como("anon", () =>
    q("select * from public.horarios_libres($1, $2, $3::date, $4)", [negA, servA, lunes, profAna]),
  );
  assert.equal(slots.length, 26);
});

await prueba("token: fuera del plazo no se cancela, salvo en los 15 minutos de haber reservado", async () => {
  const t = await uno(
    `insert into public.turnos (negocio_id, profesional_id, servicio_id, cliente_id, inicio, fin, created_at)
     select negocio_id, $1, servicio_id, cliente_id, now() + interval '1 hour', now() + interval '2 hours', now() - interval '20 minutes'
     from public.turnos limit 1
     returning token_cancelacion`,
    [profAna],
  );
  await como("anon", async () => {
    const v = (await uno("select public.ver_turno($1) as v", [t.token_cancelacion])).v;
    assert.equal(v.puede_cancelar, false);
    await falla(q("select public.cancelar_turno_cliente($1)", [t.token_cancelacion]), /FUERA_DE_PLAZO/, "fuera de plazo");
  });

  // Recién reservado (dentro del plazo de 2 h): se puede arrepentir.
  await q("update public.turnos set created_at = now() - interval '5 minutes' where token_cancelacion = $1", [t.token_cancelacion]);
  await como("anon", async () => {
    const v = (await uno("select public.ver_turno($1) as v", [t.token_cancelacion])).v;
    assert.equal(v.puede_cancelar, true);
    assert.equal(v.por_arrepentimiento, true);
    assert.ok(new Date(v.cancelable_hasta).getTime() - Date.now() < 11 * 60_000, "hasta los 15 minutos");
    await q("select public.cancelar_turno_cliente($1)", [t.token_cancelacion]);
  });
});

// --- Dueño y empleado ----------------------------------------------------------------

await prueba("empleada: ve solo su agenda y no puede editar la configuración", async () => {
  await db.query("insert into public.perfiles (id, negocio_id, rol, nombre, profesional_id) values ($1, $2, 'empleado', 'Eva', $3)", [
    USUARIOS.eva,
    negA,
    profEva,
  ]);
  await como("eva", async () => {
    const turnos = await q("select * from public.turnos");
    assert.ok(turnos.length >= 1);
    assert.ok(turnos.every((t) => t.profesional_id === profEva));
    // De sus turnos ve los datos con que se pidieron, nunca las fichas de clientes.
    assert.ok(turnos.some((t) => t.nombre_reserva === "Otro" && t.telefono_reserva === "1144445555"));
    assert.equal((await q("select * from public.clientes")).length, 0);
    assert.equal((await q("select * from public.servicios")).length, 1); // puede leer el catálogo
    assert.equal((await q("select * from public.perfiles")).length, 1); // solo su perfil
    await falla(
      q("insert into public.servicios (negocio_id, nombre, duracion_min) values ($1, 'X', 30)", [negA]),
      /row-level security/,
      "empleada crea servicio",
    );
    const upd = await db.query("update public.servicios set precio = 1 where id = $1", [servA]);
    assert.equal(upd.affectedRows, 0);
    await falla(
      q("update public.turnos set profesional_id = $1 where profesional_id = $2", [profAna, profEva]),
      /row-level security/,
      "pasar turno a otra profesional",
    );
    assert.equal((await db.query("update public.negocios set nombre = 'X'")).affectedRows, 0);
    assert.equal((await db.query("update public.clientes set notas = 'X'")).affectedRows, 0);
    assert.equal((await db.query("delete from public.clientes")).affectedRows, 0);
    const neg = await uno("select nombre from public.negocios");
    assert.equal(neg.nombre, "Salón Ana");
    await falla(q("select public.crear_negocio('Propio', 'propio-eva', 'otro', 'Eva')"), /YA_TIENE_NEGOCIO/, "otro negocio");
  });
});

await prueba("panel: crear_turno_panel respeta permisos y superposición", async () => {
  const inicio = (await uno("select (($1::date + time '15:00') at time zone 'America/Argentina/Buenos_Aires') as t", [lunes])).t;
  await como("eva", () =>
    falla(
      q("select public.crear_turno_panel($1, $2, $3, 'Cli', '1133332222')", [profAna, servA, inicio]),
      /SIN_PERMISO/,
      "empleada en agenda ajena",
    ),
  );
  const { id } = await como("eva", () =>
    uno("select public.crear_turno_panel($1, $2, $3, 'Cli', '1133332222') as id", [profEva, servA, inicio]),
  );
  assert.ok(id);
  await como("ana", () =>
    falla(
      q("select public.crear_turno_panel($1, $2, $3, 'Cli2', '1133332223')", [profEva, servA, inicio]),
      /HORARIO_NO_DISPONIBLE/,
      "superpuesto desde panel",
    ),
  );
  await como("beto", () =>
    falla(
      q("select public.crear_turno_panel($1, $2, $3, 'Cli', '1133332222')", [profEva, servA, inicio]),
      /SIN_PERMISO/,
      "otro negocio",
    ),
  );
});

await prueba("turnos fijos: semanal y cada 2 semanas, salteos, cron, terminar y permisos", async () => {
  const profFijo = (await uno("insert into public.profesionales (negocio_id, nombre) values ($1, 'Fijo') returning id", [negA])).id;
  const TZ = "America/Argentina/Buenos_Aires";
  const enHora = async (fecha, h) => (await uno("select (($1::date + $2::time) at time zone $3) as t", [fecha, h, TZ])).t;
  const mas = async (dias) => (await uno("select ($1::date + $2::int)::text as d", [lunes, dias])).d;
  const inicio = await enHora(lunes, "21:00");
  const crear = (usuario, prof, cada, nombre, tel) =>
    como(usuario, () =>
      uno("select id, turnos, fechas::text[] as salteadas from public.crear_turno_fijo($1, $2, $3, $4, $5, $6) as x(id, turnos, fechas)", [
        prof, servA, inicio, cada, nombre, tel,
      ]),
    );

  await como("eva", () => falla(q("select * from public.crear_turno_fijo($1, $2, $3, 1, 'X Y', '1155550001')", [profAna, servA, inicio]), /SIN_PERMISO/, "empleada en agenda ajena"));
  await como("beto", () => falla(q("select * from public.crear_turno_fijo($1, $2, $3, 1, 'X Y', '1155550001')", [profFijo, servA, inicio]), /SIN_PERMISO/, "otro negocio"));
  await como("ana", () => falla(q("select * from public.crear_turno_fijo($1, $2, $3, 3, 'X Y', '1155550001')", [profFijo, servA, inicio]), /DATOS_INVALIDOS/, "cada 3 semanas"));

  // Semanal, en la agenda de la empleada: una por semana hasta hoy + 56 días.
  const { semanas } = await uno("select (((now() at time zone $2)::date + 56 - $1::date) / 7 + 1) as semanas", [lunes, TZ]);
  const e = await crear("eva", profEva, 1, "Fijo Eva", "1155550001");
  assert.equal(e.turnos.length, semanas);
  assert.deepEqual(e.salteadas, []);
  const deEva = await q("select estado, extract(isodow from inicio at time zone $2)::int as dia, to_char(inicio at time zone $2, 'HH24:MI') as hora from public.turnos where turno_fijo_id = $1", [e.id, TZ]);
  assert.equal(deEva.length, semanas);
  assert.ok(deEva.every((t) => t.estado === "confirmado" && t.dia === 1 && t.hora === "21:00"));
  assert.equal((await como("eva", () => q("select id from public.turnos_fijos"))).length, 1);
  assert.equal((await como("beto", () => q("select id from public.turnos_fijos"))).length, 0);

  // Cada 2 semanas, con una ausencia y un turno ocupado: esas fechas se saltean.
  const lunes14 = await mas(14);
  const lunes28 = await mas(28);
  const ini14 = await enHora(lunes14, "21:00");
  const ini28 = await enHora(lunes28, "21:00");
  await como("ana", () => q("insert into public.bloqueos (negocio_id, profesional_id, inicio, fin) values ($1, $2, $3, $3::timestamptz + interval '1 hour')", [negA, profFijo, ini14]));
  const { id: otro } = await como("ana", () => uno("select public.crear_turno_panel($1, $2, $3, 'Otro Cliente', '1155550009') as id", [profFijo, servA, ini28]));
  const { quincenas } = await uno("select (((now() at time zone $2)::date + 56 - $1::date) / 14 + 1) as quincenas", [lunes, TZ]);
  const f = await crear("ana", profFijo, 2, "Fijo Ana", "1155550002");
  assert.deepEqual(f.salteadas, [lunes14, lunes28]);
  assert.equal(f.turnos.length, quincenas - 2);
  const regla = await uno("select fechas_salteadas::text[] as s, cliente_id from public.turnos_fijos where id = $1", [f.id]);
  assert.deepEqual(regla.s, [lunes14, lunes28]);
  assert.ok(regla.cliente_id, "crea la ficha del cliente");

  // Cron: solo el servidor; recrea lo que falta y no duplica ni revive cancelados.
  await como("anon", () => falla(q("select public.completar_turnos_fijos()"), /permission denied/, "anon"));
  await como("ana", () => falla(q("select public.completar_turnos_fijos()"), /permission denied/, "dueña"));
  const [segundo] = await q("select id from public.turnos where turno_fijo_id = $1 order by inicio offset 1 limit 1", [e.id]);
  await como("ana", () => q("update public.turnos set estado = 'cancelado', cancelado_at = now(), cancelado_por = 'negocio' where id = $1", [segundo.id]));
  await q("delete from public.turnos where turno_fijo_id = $1 and inicio = (select max(inicio) from public.turnos where turno_fijo_id = $1)", [e.id]);
  await q("update public.turnos_fijos set generado_hasta = $2::date where id = $1", [e.id, await mas((semanas - 2) * 7)]);
  assert.equal((await como("servidor", () => uno("select public.completar_turnos_fijos() as n"))).n, 1);
  assert.equal((await como("servidor", () => uno("select public.completar_turnos_fijos() as n"))).n, 0);
  const estados = await q("select estado from public.turnos where turno_fijo_id = $1", [e.id]);
  assert.equal(estados.length, semanas);
  assert.equal(estados.filter((t) => t.estado === "cancelado").length, 1);

  // Terminar: la empleada no toca reglas de otra agenda; se cancelan los que vienen.
  await como("eva", () => falla(q("select public.terminar_turno_fijo($1)", [f.id]), /SIN_PERMISO/, "regla ajena"));
  const { ids } = await como("eva", () => uno("select public.terminar_turno_fijo($1) as ids", [e.id]));
  assert.equal(ids.length, semanas - 1);
  assert.equal((await uno("select count(*)::int as n from public.turnos where turno_fijo_id = $1 and estado <> 'cancelado'", [e.id])).n, 0);
  assert.ok((await uno("select terminado_at from public.turnos_fijos where id = $1", [e.id])).terminado_at);
  assert.equal((await como("servidor", () => uno("select public.completar_turnos_fijos() as n"))).n, 0);

  await q("delete from public.turnos where turno_fijo_id = any($1) or id = $2", [[e.id, f.id], otro]);
  await q("delete from public.turnos_fijos where id = any($1)", [[e.id, f.id]]);
  await q("delete from public.bloqueos where profesional_id = $1", [profFijo]);
});

await prueba("servicio por profesional: precio y duración propios en horarios, reservas, panel y portal", async () => {
  const TZ = "America/Argentina/Buenos_Aires";
  const fecha = (await uno("select ($1::date + 21)::text as d", [lunes])).d;
  const enHora = async (h) => (await uno("select (($1::date + $2::time) at time zone $3) as t", [fecha, h, TZ])).t;
  const minutos = (t) => Math.round((new Date(t.fin) - new Date(t.inicio)) / 60000);
  const { servX, profX } = await como("ana", async () => {
    const servX = (await uno("insert into public.servicios (negocio_id, nombre, duracion_min, precio) values ($1, 'Barba', 30, 5000) returning id", [negA])).id;
    const profX = (await uno("insert into public.profesionales (negocio_id, nombre) values ($1, 'Xavi') returning id", [negA])).id;
    await q("select public.guardar_horarios($1, $2::jsonb)", [profX, JSON.stringify([{ dia_semana: 1, desde: "09:00", hasta: "18:00" }])]);
    await q("select public.guardar_profesionales_servicio($1, $2::jsonb)", [
      servX,
      JSON.stringify([{ profesional_id: profAna, precio: null, duracion_min: null }, { profesional_id: profX, precio: 7000, duracion_min: 45 }]),
    ]);
    return { servX, profX };
  });
  const filas = [{ profesional_id: profX, precio: 1, duracion_min: null }];
  await como("eva", () => falla(q("select public.guardar_profesionales_servicio($1, $2::jsonb)", [servX, JSON.stringify(filas)]), /SIN_PERMISO/, "empleada"));
  await como("beto", () => falla(q("select public.guardar_profesionales_servicio($1, $2::jsonb)", [servX, JSON.stringify(filas)]), /SIN_PERMISO/, "otro negocio"));
  await como("ana", () =>
    falla(q("select public.guardar_profesionales_servicio($1, $2::jsonb)", [servX, JSON.stringify([{ profesional_id: profX, precio: -1 }])]), /check/, "precio negativo"),
  );

  // Horarios libres: cada uno con su duración.
  const libres = await como("anon", () => q("select * from public.horarios_libres($1, $2, $3::date)", [negA, servX, fecha]));
  const deX = libres.filter((h) => h.profesional_id === profX);
  const deAna = libres.filter((h) => h.profesional_id === profAna);
  assert.ok(deX.length && deAna.length);
  assert.ok(deX.every((h) => minutos(h) === 45) && deAna.every((h) => minutos(h) === 30));

  // Reserva con Xavi: su precio y su duración.
  const r1 = await reservar("select * from public.crear_reserva($1, $2, $3, $4, 'Por Pro', '1166660001', 'porpro1@mail.com')", [negA, servX, profX, await enHora("09:00")]);
  const t1 = await uno("select precio, inicio, fin from public.turnos where id = $1", [r1.turno_id]);
  assert.equal(Number(t1.precio), 7000);
  assert.equal(minutos(t1), 45);
  // Con "cualquiera", el precio y el fin son los de quien queda asignado.
  const r2 = await reservar("select * from public.crear_reserva($1, $2, null, $3, 'Por Pro', '1166660002', 'porpro2@mail.com')", [negA, servX, await enHora("16:00")]);
  const t2 = await uno("select profesional_id, precio, inicio, fin from public.turnos where id = $1", [r2.turno_id]);
  assert.deepEqual([Number(t2.precio), minutos(t2)], t2.profesional_id === profX ? [7000, 45] : [5000, 30]);

  // Panel: Ana usa el general; Eva no lo tiene asignado y también usa el general.
  const desdePanel = (prof, h, tel) =>
    como("ana", async () => (await uno("select public.crear_turno_panel($1, $2, $3, 'Panel', $4) as id", [prof, servX, await enHora(h), tel])).id);
  const p1 = await uno("select precio, inicio, fin from public.turnos where id = $1", [await desdePanel(profX, "11:00", "1166660003")]);
  assert.deepEqual([Number(p1.precio), minutos(p1)], [7000, 45]);
  const p2 = await uno("select precio, inicio, fin from public.turnos where id = $1", [await desdePanel(profEva, "11:00", "1166660004")]);
  assert.deepEqual([Number(p2.precio), minutos(p2)], [5000, 30]);

  // Turno fijo: la regla toma la duración de Xavi y los turnos su precio.
  const fijo = await como("ana", async () =>
    uno("select id, turnos from public.crear_turno_fijo($1, $2, $3, 1, 'Fijo Pro', '1166660005')", [profX, servX, await enHora("13:00")]),
  );
  assert.equal((await uno("select duracion_min from public.turnos_fijos where id = $1", [fijo.id])).duracion_min, 45);
  const precios = await q("select distinct precio from public.turnos where turno_fijo_id = $1", [fijo.id]);
  assert.deepEqual(precios.map((p) => Number(p.precio)), [7000]);

  // Portal: valores efectivos por profesional.
  const pub = await como("anon", () => uno("select public.negocio_publico('salon-ana') as d"));
  const s = pub.d.servicios.find((x) => x.id === servX);
  assert.equal(s.precio, 5000);
  assert.deepEqual(s.por_profesional[profX], { precio: 7000, duracion_min: 45, sena: null });
  assert.deepEqual(s.por_profesional[profAna], { precio: 5000, duracion_min: 30, sena: null });

  // Sin nadie tildado el servicio queda sin asignar (y fuera del portal).
  await como("ana", () => q("select public.guardar_profesionales_servicio($1, '[]'::jsonb)", [servX]));
  const pub2 = await como("anon", () => uno("select public.negocio_publico('salon-ana') as d"));
  assert.ok(!pub2.d.servicios.some((x) => x.id === servX));

  await q("delete from public.turnos where servicio_id = $1", [servX]);
  await q("delete from public.turnos_fijos where id = $1", [fijo.id]);
  await q("delete from public.servicios where id = $1", [servX]);
  await q("delete from public.profesionales where id = $1", [profX]);
});

await prueba("bug corregido: una empleada no lee la ficha de un cliente aunque conozca su celular", async () => {
  // Lucía ya es clienta (reservó online). La dueña le agrega notas privadas.
  const lucia = await uno("select id from public.clientes where telefono = '1155551234'");
  await como("ana", () => q("update public.clientes set notas = 'Prefiere los martes' where id = $1", [lucia.id]));

  // Eva carga un turno en su agenda con el celular de Lucía y otro nombre y mail.
  const inicio = (await uno("select (($1::date + 7 + time '09:00') at time zone 'America/Argentina/Buenos_Aires') as t", [lunes])).t;
  const { id } = await como("eva", () =>
    uno("select public.crear_turno_panel($1, $2, $3, 'Curiosa', '011 15 5555-1234', 'curiosa@mail.com') as id", [profEva, servA, inicio]),
  );
  await como("eva", async () => {
    const turno = await uno("select * from public.turnos where id = $1", [id]);
    assert.equal(turno.nombre_reserva, "Curiosa");
    assert.equal(turno.cliente_id, lucia.id); // queda en la ficha de Lucía, que la dueña sí ve
    assert.equal((await q("select * from public.clientes where id = $1", [lucia.id])).length, 0);
    assert.equal((await q("select * from public.clientes where telefono = '1155551234'")).length, 0);
    await falla(q("select public.estadisticas_negocio(now(), now())"), /SIN_PERMISO/, "estadísticas");
  });
  // La ficha no cambió: ni el nombre ni el mail que cargó la empleada.
  const ficha = await uno("select nombre, email, notas from public.clientes where id = $1", [lucia.id]);
  assert.deepEqual({ ...ficha }, { nombre: "Lucía", email: "lucia@mail.com", notas: "Prefiere los martes" });
  // La dueña ve la ficha completa y el turno con los datos que se cargaron.
  await como("ana", async () => {
    assert.equal((await q("select * from public.clientes where id = $1", [lucia.id])).length, 1);
    assert.equal((await uno("select nombre_reserva from public.turnos where id = $1", [id])).nombre_reserva, "Curiosa");
  });
});

await prueba("aislamiento: ninguna tabla con negocio_id deja ver filas de otro negocio", async () => {
  const tablas = (
    await q(`
      select table_name from information_schema.columns
      where table_schema = 'public' and column_name = 'negocio_id' order by 1`)
  ).map((t) => t.table_name);
  assert.ok(tablas.length >= 9, tablas.join(", "));
  for (const t of tablas) {
    const { n: deA } = await uno(`select count(*)::int as n from public.${t} where negocio_id = $1`, [negA]);
    if (t !== "integraciones") assert.ok(deA > 0 || ["bloqueos", "integraciones", "negocio_logos", "negocio_portadas", "pedidos", "productos", "resenas", "turnos_fijos"].includes(t), `${t} sin datos de prueba`);
    for (const [u, ajeno] of [["beto", negA], ["nadie", negA], ["ana", negB], ["eva", negB]]) {
      const filas = await como(u, () => q(`select * from public.${t} where negocio_id = $1`, [ajeno]).catch(() => []));
      assert.equal(filas.length, 0, `${u} ve ${t} de otro negocio`);
    }
  }
});

await prueba("aislamiento: un usuario del panel no toca accesos, secretos ni límites", async () => {
  for (const u of ["ana", "eva"]) {
    await como(u, async () => {
      for (const t of ["accesos", "integraciones_secretos", "limites_uso"]) {
        await falla(q(`select * from public.${t}`), /permission denied/, `${u} ${t}`);
      }
      await falla(q("insert into public.perfiles (id, negocio_id, rol, nombre) values ($1, $2, 'dueno', 'Yo')", [USUARIOS.nadie, negA]), /row-level security/, `${u} crea perfil`);
      assert.equal((await db.query("update public.perfiles set rol = 'dueno'")).affectedRows, 0, `${u} cambia roles`);
      assert.equal((await db.query("delete from public.perfiles")).affectedRows, 0, `${u} borra perfiles`);
    });
  }
});

const comoServicioQ = servicio;

// Reserva de prueba en el salón de Ana: un lunes, con semanas de diferencia.
const reservarAna = async (semanas, hora, nombre, telefono, email) => {
  const { t } = await uno("select (($1::date + $2::int * 7 + $3::time) at time zone 'America/Argentina/Buenos_Aires') as t", [lunes, semanas, hora]);
  return reservar("select * from public.crear_reserva($1, $2, $3, $4, $5, $6, $7)", [negA, servA, profAna, t, nombre, telefono, email]);
};

await prueba("reserva: el email es obligatorio", async () => {
  await falla(reservarAna(1, "09:00", "Sin Mail", "1188880000", null), /DATOS_INVALIDOS/, "sin email");
  await falla(reservarAna(1, "09:00", "Sin Mail", "1188880000", "  "), /DATOS_INVALIDOS/, "email vacío");
});

await prueba("un turno por día con cada email; otras fechas se pueden pedir en la misma sesión", async () => {
  const r = await reservarAna(0, "09:00", "Diaria", "1188881111", "diaria@mail.com");
  await falla(reservarAna(0, "11:00", "Diaria", "1188882222", "DIARIA@mail.com"), /LIMITE_DIARIO/, "mismo email, otro celular");
  const viernes = await reservarAna(1, "11:00", "Diaria", "1188881111", "diaria@mail.com");
  assert.ok(viernes.turno_id, "otra fecha, en la misma sesión");
  await como("anon", () => q("select public.cancelar_turno_cliente($1)", [viernes.token]));

  // Quien comparte el celular reserva ese día con su email, pero una sola vez.
  assert.ok((await reservarAna(0, "11:00", "Hija", "1188881111", "hija@mail.com")).turno_id);
  await falla(reservarAna(0, "14:00", "Hija", "1188881111", "hija@mail.com"), /LIMITE_DIARIO/, "email que no quedó en el cliente");

  // Cancelar libera la fecha.
  await como("anon", () => q("select public.cancelar_turno_cliente($1)", [r.token]));
  assert.ok((await reservarAna(0, "09:00", "Diaria", "1188881111", "diaria@mail.com")).turno_id);
});

await prueba("anti-abuso: máximo 3 turnos futuros por local, por email o celular", async () => {
  for (const semanas of [1, 2, 3]) await reservarAna(semanas, "09:00", "Spam", "1199990000", "spam@mail.com");
  await falla(reservarAna(0, "14:00", "Spam", "1199990000", "otro.spam@mail.com"), /LIMITE_TURNOS/, "cuarto por celular");
  await falla(reservarAna(0, "14:00", "Spam", "1199991111", "spam@mail.com"), /LIMITE_TURNOS/, "cuarto por email");
});

await prueba("inasistencias: con 3 limita a un turno a la vez hasta que se quita el límite", async () => {
  const primero = await reservarAna(1, "14:00", "Faltó", "1177770000", "falto@mail.com");
  const turno = await uno("select * from public.turnos where id = $1", [primero.turno_id]);
  const faltar = async (dias) =>
    (
      await uno(
        "insert into public.turnos (negocio_id, profesional_id, servicio_id, cliente_id, inicio, fin, estado, precio) values ($1, $2, $3, $4, now() - make_interval(days => $5), now() - make_interval(days => $5) + interval '1 hour', 'ausente', 1000) returning id",
        [turno.negocio_id, turno.profesional_id, turno.servicio_id, turno.cliente_id, dias],
      )
    ).id;

  // Con 2 todavía puede tener más de un turno.
  await faltar(3);
  await faltar(4);
  const segundo = await reservarAna(2, "14:00", "Faltó", "1177770000", "falto@mail.com");
  await como("anon", () => q("select public.cancelar_turno_cliente($1)", [segundo.token]));

  const tercera = await faltar(5);
  await falla(reservarAna(2, "14:00", "Faltó", "1177770000", "falto@mail.com"), /LIMITE_AUSENCIAS/, "con un turno futuro");
  await falla(reservarAna(2, "14:00", "Faltó", "1177771111", "falto@mail.com"), /LIMITE_AUSENCIAS/, "mismo email, otro celular");

  // Sin turnos futuros puede reservar uno, pero no un segundo.
  await como("anon", () => q("select public.cancelar_turno_cliente($1)", [primero.token]));
  assert.ok((await reservarAna(2, "14:00", "Faltó", "1177770000", "falto@mail.com")).turno_id);
  await falla(reservarAna(3, "14:00", "Faltó", "1177770000", "falto@mail.com"), /LIMITE_AUSENCIAS/, "segundo turno futuro");

  // La dueña le quita el límite.
  await como("ana", () => q("update public.clientes set ausencias_perdonadas_at = now() where id = $1", [turno.cliente_id]));
  const cuarto = await reservarAna(3, "14:00", "Faltó", "1177770000", "falto@mail.com");
  assert.ok(cuarto.turno_id);

  // Sin perdonar, deshacer una de las 3 inasistencias también lo quita.
  await q("update public.clientes set ausencias_perdonadas_at = null where id = $1", [turno.cliente_id]);
  await como("anon", () => q("select public.cancelar_turno_cliente($1)", [cuarto.token]));
  await falla(reservarAna(3, "14:00", "Faltó", "1177770000", "falto@mail.com"), /LIMITE_AUSENCIAS/, "vuelve el límite");
  await q("update public.turnos set estado = 'completado' where id = $1", [tercera]);
  assert.ok((await reservarAna(3, "14:00", "Faltó", "1177770000", "falto@mail.com")).turno_id);

  // Una inasistencia no suma ingresos: al pasarla a atendido aparecen sus 1000.
  const ingresos = async () => {
    const { e } = await como("ana", () => uno("select public.estadisticas_negocio(now() - interval '30 days', now() + interval '60 days') as e"));
    return e.por_servicio.reduce((total, x) => total + Number(x.ingresos), 0);
  };
  const atendido = await ingresos();
  await q("update public.turnos set estado = 'ausente' where id = $1", [tercera]);
  assert.equal(await ingresos(), atendido - 1000);
});

await prueba("alias de mail: +etiqueta, puntos de Gmail y mayúsculas son la misma persona", async () => {
  const clave = async (e) => (await uno("select public.clave_email($1) as c", [e])).c;
  assert.equal(await clave("  J.U.A.N+promo@GoogleMail.com "), "juan@gmail.com");
  assert.equal(await clave("ana+turnos@mail.com"), "ana@mail.com");
  assert.equal(await clave("ana.perez@mail.com"), "ana.perez@mail.com", "los puntos solo se ignoran en Gmail");
  assert.equal(await clave(null), null);

  const r = await reservarAna(0, "16:00", "Alias", "1166660000", "Ali.As+uno@gmail.com");
  await falla(reservarAna(0, "15:00", "Alias", "1166661111", "alias@googlemail.com"), /LIMITE_DIARIO/, "googlemail sin puntos");
  await falla(reservarAna(0, "15:00", "Alias", "1166661111", "aliAS+dos@GMAIL.com"), /LIMITE_DIARIO/, "otra etiqueta");
  // El mail queda guardado como lo escribió.
  assert.equal((await uno("select email_reserva from public.turnos where id = $1", [r.turno_id])).email_reserva, "ali.as+uno@gmail.com");
  await como("anon", () => q("select public.cancelar_turno_cliente($1)", [r.token]));
});

await prueba("ficha: el límite de inasistencias cruza celular y mail, y se quita en todas las fichas", async () => {
  const turno = await uno("select * from public.turnos where negocio_id = $1 limit 1", [negA]);
  const ficha = async (tel) =>
    (await uno("insert into public.clientes (negocio_id, nombre, telefono, email) values ($1, 'Cruz', $2, 'cruz@mail.com') returning id", [negA, tel])).id;
  const fichaA = await ficha("1155550000");
  const fichaB = await ficha("1155551111");
  for (const dias of [10, 11, 12]) {
    await q(
      "insert into public.turnos (negocio_id, profesional_id, servicio_id, cliente_id, inicio, fin, estado, precio) values ($1, $2, $3, $4, now() - make_interval(days => $5), now() - make_interval(days => $5) + interval '1 hour', 'ausente', 1000)",
      [negA, turno.profesional_id, turno.servicio_id, fichaA, dias],
    );
  }
  const limite = (id) => como("ana", async () => (await uno("select public.inasistencias_que_limitan($1) as n", [id])).n);
  assert.equal(await limite(fichaA), 3);
  assert.equal(await limite(fichaB), 3, "la otra ficha con el mismo mail también");
  await como("eva", async () => assert.equal((await uno("select public.inasistencias_que_limitan($1) as n", [fichaB])).n, 0, "empleada no ve fichas"));

  const tocadas = await como("ana", async () => (await uno("select public.quitar_limite_cliente($1) as n", [fichaB])).n);
  assert.equal(tocadas, 2);
  assert.equal(await limite(fichaA), 0);
  await q("delete from public.turnos where cliente_id = $1", [fichaA]);
  await q("delete from public.clientes where id = any($1)", [[fichaA, fichaB]]);
});

await prueba("borrar cliente: se va la ficha, los turnos quedan con el nombre y el precio", async () => {
  const cli = (await uno(
    "insert into public.clientes (negocio_id, nombre, telefono, email, notas) values ($1, 'Borra Me', '1144448888', 'borra@mail.com', 'nota privada') returning id",
    [negA],
  )).id;
  const turno = (sql, intervalo, estado) =>
    uno(
      `insert into public.turnos (negocio_id, profesional_id, servicio_id, cliente_id, inicio, fin, estado, precio, telefono_reserva, email_reserva)
       values ($1, $2, $3, $4, now() + $5::interval, now() + $5::interval + interval '1 hour', $6, 5000, '1144448888', 'borra@mail.com') returning id`,
      [negA, profAna, servA, cli, intervalo, estado],
    );
  const pasado = (await turno(null, "-40 days", "completado")).id;
  const futuro = (await turno(null, "45 days", "confirmado")).id;

  await como("ana", () => falla(q("select public.borrar_cliente($1)", [cli]), /TIENE_TURNOS_FUTUROS/, "con turno por venir"));
  await como("eva", () => falla(q("select public.borrar_cliente($1)", [cli]), /NO_ENCONTRADO/, "empleada"));
  await como("beto", () => falla(q("select public.borrar_cliente($1)", [cli]), /NO_ENCONTRADO/, "otro negocio"));

  await q("update public.turnos set estado = 'cancelado' where id = $1", [futuro]);
  const n = await como("ana", async () => (await uno("select public.borrar_cliente($1) as n", [cli])).n);
  assert.equal(n, 2);
  assert.equal(await uno("select id from public.clientes where id = $1", [cli]), undefined);
  const t = await uno("select * from public.turnos where id = $1", [pasado]);
  assert.equal(t.cliente_id, null);
  assert.equal(t.nombre_reserva, "Borra Me");
  assert.equal(Number(t.precio), 5000);
  assert.equal(t.telefono_reserva, null);
  assert.equal(t.email_reserva, null);
  // Sigue sumando en las estadísticas y su página de turno se ve.
  const { e } = await como("ana", () => uno("select public.estadisticas_negocio(now() - interval '60 days', now()) as e"));
  assert.ok(Number(e.ingresos) >= 5000);
  assert.equal((await como("anon", () => uno("select public.ver_turno($1) as v", [t.token_cancelacion]))).v.cliente, "Borra Me");
  await q("delete from public.turnos where id = any($1)", [[pasado, futuro]]);
});

await prueba("reserva hasta 90 días y estadísticas sin precio", async () => {
  await q("update public.negocios set anticipacion_max_dias = 90 where id = $1", [negA]);
  const { n } = await como("anon", () =>
    uno("select count(*)::int as n from public.dias_disponibles($1, $2, $3::date, 91, $4)", [negA, servA, lunes, profAna]),
  );
  assert.ok(n >= 12, `lunes en 90 días: ${n}`);
  await q("update public.negocios set anticipacion_max_dias = 30 where id = $1", [negA]);

  const est = () => como("ana", async () => (await uno("select public.estadisticas_negocio(now() - interval '30 days', now() + interval '60 days') as e")).e);
  const antes = (await est()).sin_precio;
  const cliente = (await uno("select id from public.clientes where negocio_id = $1 limit 1", [negA])).id;
  const { id } = await uno(
    "insert into public.turnos (negocio_id, profesional_id, servicio_id, cliente_id, inicio, fin, estado, precio) values ($1, $2, $3, $4, now() + interval '50 days', now() + interval '50 days 1 hour', 'confirmado', null) returning id",
    [negA, profAna, servA, cliente],
  );
  assert.equal((await est()).sin_precio, antes + 1);
  await q("delete from public.turnos where id = $1", [id]);
});

await prueba("rubros: peluquería separada, con sus servicios típicos cargados", async () => {
  await como("nadie", () =>
    falla(q("select public.crear_negocio('Viejo', 'rubro-viejo', 'peluqueria', 'Nadie')"), /negocios_rubro_check/, "rubro viejo"),
  );
  const id = await como("nadie", async () =>
    (await uno("select public.crear_negocio('Barber', 'barber-nadie', 'peluqueria_masculina', 'Nadie') as id")).id,
  );
  const servicios = await q("select nombre, precio from public.servicios where negocio_id = $1 order by orden", [id]);
  assert.deepEqual(servicios.map((x) => x.nombre), ["Corte de pelo", "Corte y barba", "Arreglo de barba", "Corte infantil"]);
  assert.ok(servicios.every((x) => x.precio === null));
  const { n } = await uno("select count(*)::int as n from public.profesional_servicio where negocio_id = $1", [id]);
  assert.equal(n, 4);
  const { intervalo_min } = await uno("select intervalo_min from public.negocios where id = $1", [id]);
  assert.equal(intervalo_min, 10);
});

await prueba("celular: todos los formatos argentinos quedan iguales", async () => {
  const casos = ["341 881 0001", "+54 9 341 881 0001", "54 341 881 0001", "0341 15 881 0001", "341 15 881 0001", "0054 9 341 881 0001"];
  for (const c of casos) {
    assert.equal((await uno("select public.normalizar_telefono($1) as n", [c])).n, "3418810001", c);
  }
  assert.equal((await uno("select public.normalizar_telefono('+598 99 123 456') as n")).n, "59899123456");
});

await prueba("celular: otro formato no saltea el máximo de 3", async () => {
  for (const [semanas, tel] of [[1, "341 882 0001"], [2, "+54 9 341 882 0001"], [3, "0341 15 882 0001"]]) {
    await reservarAna(semanas, "16:00", "Formatos", tel, "formatos" + semanas + "@mail.com");
  }
  await falla(reservarAna(0, "16:00", "Formatos", "54 341 882 0001", "formatos4@mail.com"), /LIMITE_TURNOS/, "cuarto en otro formato");
  const { n } = await uno("select count(*)::int as n from public.clientes where telefono = '3418820001'");
  assert.equal(n, 1);
});

await prueba("reserva con un celular ajeno: no revela ni toca la ficha, y avisa a quien reservó", async () => {
  const cliente = await como("eva", () =>
    uno("select public.crear_turno_panel($1, $2, (($3::date + 7 + time '15:00') at time zone 'America/Argentina/Buenos_Aires'), 'Don Panel', '3418830001') as id", [profEva, servA, lunes]),
  );
  assert.ok(cliente.id);
  const r = await reservarAna(1, "17:00", "Otra Persona", "3418830001", "otra@mail.com");
  const visto = await como("anon", async () => (await uno("select public.ver_turno($1) as d", [r.token])).d);
  assert.equal(visto.cliente, "Otra Persona");

  const ficha = await uno("select nombre, email from public.clientes where telefono = '3418830001'");
  assert.deepEqual({ ...ficha }, { nombre: "Don Panel", email: null });

  await q("update public.turnos set inicio = now() + interval '20 hours', fin = now() + interval '21 hours', created_at = now() - interval '1 day' where id = $1", [r.turno_id]);
  const avisos = await comoServicioQ("select * from public.reclamar_recordatorios()");
  const aviso = avisos.find((x) => x.turno_id === r.turno_id);
  assert.equal(aviso.email, "otra@mail.com");
  assert.equal(aviso.cliente, "Otra Persona");

  // Al cambiarlo de horario, el recordatorio se vuelve a mandar.
  await q("update public.turnos set inicio = now() + interval '22 hours', fin = now() + interval '23 hours' where id = $1", [r.turno_id]);
  const { recordatorio_enviado_at } = await uno("select recordatorio_enviado_at from public.turnos where id = $1", [r.turno_id]);
  assert.equal(recordatorio_enviado_at, null);
});

await prueba("estado: un turno futuro no puede figurar atendido ni como inasistencia", async () => {
  const r = await reservarAna(2, "17:00", "Futuro", "3418840001", "futuro@mail.com");
  await falla(q("update public.turnos set estado = 'ausente' where id = $1", [r.turno_id]), /TURNO_FUTURO/, "ausente");
  await falla(q("update public.turnos set estado = 'completado' where id = $1", [r.turno_id]), /TURNO_FUTURO/, "completado");
});

await prueba("permisos: el dueño lee y carga con los grants de las migraciones", async () => {
  await como("ana", async () => {
    assert.ok((await q("select id from public.perfiles")).length >= 1);
    assert.ok((await q("select id from public.turnos")).length >= 1);
    assert.ok((await q("select id from public.clientes")).length >= 1);
  });
  await comoServicioQ("select count(*) from public.integraciones_secretos");
});

await prueba("bloqueos: un bloqueo quita horarios libres", async () => {
  await como("eva", () =>
    q(
      `insert into public.bloqueos (negocio_id, profesional_id, inicio, fin, motivo)
       values ($1, $2, ($3::date + time '09:00') at time zone 'America/Argentina/Buenos_Aires',
                       ($3::date + time '13:00') at time zone 'America/Argentina/Buenos_Aires', 'Médico')`,
      [negA, profEva, lunes],
    ),
  );
  await como("eva", () =>
    falla(
      q(
        `insert into public.bloqueos (negocio_id, profesional_id, inicio, fin) values ($1, $2, now() + interval '1 day', now() + interval '2 days')`,
        [negA, profAna],
      ),
      /row-level security/,
      "bloqueo en agenda ajena",
    ),
  );
  const slots = await como("anon", () =>
    q("select * from public.horarios_libres($1, $2, $3::date, $4)", [negA, servA, lunes, profEva]),
  );
  // Solo la tarde (13) menos el turno de 15:00 (15:00-16:00 => pierde 14:15..15:45 = 7)
  assert.equal(slots.length, 13 - 7);
  const dias = await como("anon", () => q("select * from public.dias_disponibles($1, $2, $3::date, 14)", [negA, servA, lunes]));
  assert.equal(dias.length, 2); // dos lunes en 14 días
});

await prueba("recordatorios: solo el servidor, marca una sola vez", async () => {
  await como("anon", () => falla(q("select * from public.reclamar_recordatorios()"), /permission denied/, "anon"));
  await como("ana", () => falla(q("select * from public.reclamar_recordatorios()"), /permission denied/, "dueña"));

  // Turno de mañana (dentro de 24 h), con email y reservado hace rato.
  const t = await uno(
    `insert into public.turnos (negocio_id, profesional_id, servicio_id, cliente_id, inicio, fin, created_at)
     select t.negocio_id, $1, t.servicio_id, t.cliente_id, now() + interval '20 hours', now() + interval '21 hours', now() - interval '2 days'
     from public.turnos t join public.clientes c on c.id = t.cliente_id
     where c.email = 'lucia@mail.com' limit 1
     returning id`,
    [profEva],
  );
  const primera = await servicio("select * from public.reclamar_recordatorios()");
  assert.ok(primera.some((r) => r.turno_id === t.id));
  const fila = primera.find((r) => r.turno_id === t.id);
  assert.equal(fila.email, "lucia@mail.com");
  assert.equal(fila.negocio, "Salón Ana");
  const segunda = await servicio("select * from public.reclamar_recordatorios()");
  assert.ok(!segunda.some((r) => r.turno_id === t.id));
});

// --- Fases 5 y 6: seña, integraciones, Google, límites, estadísticas, WhatsApp ---
const libresAna = () =>
  como("anon", () => q("select * from public.horarios_libres($1, $2, $3::date, $4)", [negA, servA, lunes, profAna]));

await prueba("seña: sin Mercado Pago conectado no se pide seña", async () => {
  await q("update public.negocios set sena_tipo = 'porcentaje', sena_valor = 50 where id = $1", [negA]);
  const data = await como("anon", async () => (await uno("select public.negocio_publico('salon-ana') as d")).d);
  assert.equal(data.servicios[0].sena, null);
});

// La seña está apagada en la base (0020: monto_sena devuelve 0). Las tres pruebas siguientes
// cubren la maquinaria de cobro que sigue en la base (retención, vencimiento, pagos tardíos):
// para ejercitarla se vuelve a poner temporalmente la versión de 0001_inicial.sql.
await q(`
  create or replace function public.monto_sena(p_negocio public.negocios, p_precio numeric)
  returns numeric language sql stable security definer set search_path = '' as $$
    select case
      when not exists (
        select 1 from public.integraciones i
        where i.negocio_id = p_negocio.id and i.proveedor = 'mercadopago' and i.estado = 'activa'
      ) then 0
      when p_negocio.sena_tipo = 'porcentaje' and coalesce(p_precio, 0) > 0
        then round(p_precio * p_negocio.sena_valor / 100, 0)
      when p_negocio.sena_tipo = 'fijo'
        then case when coalesce(p_precio, 0) > 0 then least(p_negocio.sena_valor, p_precio) else p_negocio.sena_valor end
      else 0
    end
  $$`);

let mpA;
await prueba("seña: con Mercado Pago, la reserva queda retenida y se confirma al pagar", async () => {
  mpA = (
    await uno("insert into public.integraciones (negocio_id, proveedor, estado) values ($1, 'mercadopago', 'activa') returning id", [negA])
  ).id;
  const data = await como("anon", async () => (await uno("select public.negocio_publico('salon-ana') as d")).d);
  assert.equal(Number(data.servicios[0].sena), 4000);

  const slot = (await libresAna()).at(-1);
  const r = await reservar("select * from public.crear_reserva($1, $2, $3, $4, 'Pagadora', '1150001111', 'pagadora@mail.com')", [
    negA,
    servA,
    profAna,
    slot.inicio,
  ]);
  assert.equal(Number(r.sena), 4000);
  const t = await uno("select * from public.turnos where id = $1", [r.turno_id]);
  assert.equal(t.estado, "pendiente");
  assert.equal(t.pago_estado, "pendiente");
  assert.ok(t.pago_vence_at);

  await como("anon", () => falla(q("select public.registrar_pago($1, 'x', true, 4000)", [r.turno_id]), /permission denied/, "anon"));
  await como("ana", () => falla(q("select public.registrar_pago($1, 'x', true, 4000)", [r.turno_id]), /permission denied/, "dueña"));
  assert.equal((await servicio("select public.registrar_pago($1, 'p1', true, 4000) as r", [r.turno_id]))[0].r, "confirmado");
  assert.equal((await servicio("select public.registrar_pago($1, 'p1', true, 4000) as r", [r.turno_id]))[0].r, "ya_procesado");
  const pagado = await uno("select estado, pago_estado, pago_id from public.turnos where id = $1", [r.turno_id]);
  assert.deepEqual({ ...pagado }, { estado: "confirmado", pago_estado: "aprobado", pago_id: "p1" });
});

await prueba("seña: si vence se libera el horario; un pago tardío lo recupera si sigue libre", async () => {
  const slot = (await libresAna()).at(-1);
  const r = await reservar("select * from public.crear_reserva($1, $2, $3, $4, 'Tardía', '1150002222', 'tardia@mail.com')", [
    negA,
    servA,
    profAna,
    slot.inicio,
  ]);
  assert.ok(!(await libresAna()).some((s) => +s.inicio === +slot.inicio));
  await q("update public.turnos set pago_vence_at = now() - interval '1 minute' where id = $1", [r.turno_id]);
  assert.ok((await libresAna()).some((s) => +s.inicio === +slot.inicio), "el horario vencido vuelve a estar libre");
  const visto = await como("anon", async () => (await uno("select public.ver_turno($1) as d", [r.token])).d);
  assert.equal(visto.pago_estado, "vencido");

  assert.equal((await servicio("select public.vencer_pagos_pendientes() as n"))[0].n, 1);
  const vencido = await uno("select estado, cancelado_por, pago_estado from public.turnos where id = $1", [r.turno_id]);
  assert.deepEqual({ ...vencido }, { estado: "cancelado", cancelado_por: "sistema", pago_estado: "vencido" });

  assert.equal((await servicio("select public.registrar_pago($1, 'p2', true, 4000) as r", [r.turno_id]))[0].r, "confirmado");
  const recuperado = await uno("select estado, pago_estado from public.turnos where id = $1", [r.turno_id]);
  assert.deepEqual({ ...recuperado }, { estado: "confirmado", pago_estado: "aprobado" });
});

await prueba("seña: pago tardío con el horario ya tomado queda para reembolsar; monto menor también", async () => {
  const slot = (await libresAna()).at(-1);
  const r = await reservar("select * from public.crear_reserva($1, $2, $3, $4, 'Lenta', '1150003333', 'lenta@mail.com')", [
    negA,
    servA,
    profAna,
    slot.inicio,
  ]);
  await q("update public.turnos set pago_vence_at = now() - interval '1 minute' where id = $1", [r.turno_id]);
  // Otra persona reserva el mismo horario (crear_reserva libera la retención vencida).
  const otra = await reservar("select * from public.crear_reserva($1, $2, $3, $4, 'Rápida', '1150004444', 'rapida@mail.com')", [
    negA,
    servA,
    profAna,
    slot.inicio,
  ]);
  assert.ok(otra.turno_id);
  assert.equal((await servicio("select public.registrar_pago($1, 'p3', true, 4000) as r", [r.turno_id]))[0].r, "reembolsar");
  assert.equal((await servicio("select public.registrar_pago($1, 'p4', true, 100) as r", [otra.turno_id]))[0].r, "reembolsar");
  assert.equal((await servicio("select public.registrar_pago($1, 'p5', false, 4000) as r", [otra.turno_id]))[0].r, "ya_procesado");
  await q("update public.negocios set sena_tipo = 'ninguna' where id = $1", [negA]);
});

// Vuelve la seña apagada de la 0020.
await q(`
  create or replace function public.monto_sena(p_negocio public.negocios, p_precio numeric)
  returns numeric language sql stable security definer set search_path = '' as $$ select 0::numeric $$`);

await prueba("integraciones: secretos inaccesibles; empleada ve solo su Google", async () => {
  const gEva = (
    await uno(
      "insert into public.integraciones (negocio_id, profesional_id, proveedor, estado) values ($1, $2, 'google_calendar', 'activa') returning id",
      [negA, profEva],
    )
  ).id;
  await q("insert into public.integraciones_secretos (integracion_id, datos) values ($1, 'cifrado'), ($2, 'cifrado')", [gEva, mpA]);
  for (const u of ["ana", "eva", "anon"]) {
    await como(u, () => falla(q("select * from public.integraciones_secretos"), /permission denied/, `secretos ${u}`));
  }
  const deEva = await como("eva", () => q("select proveedor from public.integraciones"));
  assert.deepEqual(deEva.map((i) => i.proveedor), ["google_calendar"]);
  const deAna = await como("ana", () => q("select proveedor from public.integraciones order by proveedor"));
  assert.deepEqual(deAna.map((i) => i.proveedor), ["google_calendar", "mercadopago"]);
  assert.equal((await como("beto", () => q("select * from public.integraciones"))).length, 0);
  await como("ana", () =>
    falla(q("insert into public.integraciones (negocio_id, proveedor) values ($1, 'whatsapp')", [negA]), /permission denied/, "insert"),
  );
  await falla(
    q("insert into public.integraciones (negocio_id, proveedor, profesional_id) values ($1, 'google_calendar', $2)", [negA, profEva]),
    /integraciones_unica/,
    "duplicada",
  );
});

await prueba("google: cola de sincronización por versión", async () => {
  const cola = await servicio("select * from public.turnos_para_sincronizar()");
  const deEva = await q("select id from public.turnos where profesional_id = $1 and fin > now()", [profEva]);
  assert.ok(deEva.length > 0);
  for (const t of deEva) assert.ok(cola.some((c) => c.turno_id === t.id));
  const turnosAna = (await q("select id from public.turnos where profesional_id = $1", [profAna])).map((t) => t.id);
  assert.ok(!cola.some((c) => turnosAna.includes(c.turno_id)), "Ana no tiene Google conectado");

  const [primero] = cola;
  await servicio("select public.marcar_sincronizado_google($1, $2, 'ev1', $3)", [primero.turno_id, primero.version, profEva]);
  let nueva = await servicio("select * from public.turnos_para_sincronizar()");
  assert.ok(!nueva.some((c) => c.turno_id === primero.turno_id));

  await q("update public.turnos set notas = 'cambio' where id = $1", [primero.turno_id]);
  nueva = await servicio("select * from public.turnos_para_sincronizar()");
  assert.ok(nueva.some((c) => c.turno_id === primero.turno_id));
  // Versión vieja: guarda el evento pero sigue en la cola.
  await servicio("select public.marcar_sincronizado_google($1, $2, 'ev2', $3)", [primero.turno_id, primero.version, profEva]);
  nueva = await servicio("select * from public.turnos_para_sincronizar()");
  assert.ok(nueva.some((c) => c.turno_id === primero.turno_id));
  assert.equal((await uno("select google_event_id from public.turnos where id = $1", [primero.turno_id])).google_event_id, "ev2");
  await como("ana", () => falla(q("select * from public.turnos_para_sincronizar()"), /permission denied/, "dueña"));
});

await prueba("google: ocupados importados reemplazan solo los de Google", async () => {
  const manuales = Number((await uno("select count(*) as n from public.bloqueos where profesional_id = $1", [profEva])).n);
  const base = (await uno("select (($1::date + 2 + time '10:00') at time zone 'America/Argentina/Buenos_Aires') as t", [lunes])).t;
  const h = (n) => new Date(+base + n * 3_600_000).toISOString();
  const ocupados = JSON.stringify([
    { inicio: h(0), fin: h(1) },
    { inicio: h(3), fin: h(4) },
    { inicio: h(5), fin: h(5) },
  ]);
  const desde = new Date(+base - 86_400_000).toISOString();
  const hasta = new Date(+base + 86_400_000).toISOString();
  assert.equal((await servicio("select public.reemplazar_bloqueos_google($1, $2, $3, $4) as n", [profEva, desde, hasta, ocupados]))[0].n, 2);
  await servicio("select public.reemplazar_bloqueos_google($1, $2, $3, $4)", [
    profEva,
    desde,
    hasta,
    JSON.stringify([{ inicio: h(0), fin: h(2) }]),
  ]);
  const google = await q("select * from public.bloqueos where profesional_id = $1 and origen = 'google'", [profEva]);
  assert.equal(google.length, 1);
  const quedan = Number((await uno("select count(*) as n from public.bloqueos where profesional_id = $1 and origen = 'manual'", [profEva])).n);
  assert.equal(quedan, manuales);
});

await prueba("límites de uso: corta al superar el máximo de la ventana", async () => {
  const r = [];
  for (let i = 0; i < 3; i++) r.push((await servicio("select public.consumir_limite('ip:1', 2, 60) as ok"))[0].ok);
  assert.deepEqual(r, [true, true, false]);
  await como("anon", () => falla(q("select public.consumir_limite('x', 1, 60)"), /permission denied/, "anon"));
});

await prueba("estadísticas: solo la dueña, con totales del período", async () => {
  const e = await como("ana", async () =>
    (await uno("select public.estadisticas_negocio(now() - interval '30 days', now() + interval '60 days') as e")).e,
  );
  assert.ok(e.total > 0);
  assert.ok(Number(e.ingresos) > 0);
  assert.ok(e.por_servicio.length >= 1);
  assert.equal(Number(e.senas), 8000);
  await como("eva", () => falla(q("select public.estadisticas_negocio(now(), now())"), /SIN_PERMISO/, "empleada"));
  await como("beto", async () => {
    const deBeto = (await uno("select public.estadisticas_negocio(now() - interval '30 days', now() + interval '60 days') as e")).e;
    assert.equal(deBeto.total, 0);
  });
});

await prueba("whatsapp: recordatorios con marca propia", async () => {
  await q("update public.negocios set whatsapp_avisos = true where id = $1", [negA]);
  const primera = await servicio("select * from public.reclamar_recordatorios_whatsapp()");
  assert.ok(primera.length >= 1);
  assert.match(primera[0].telefono, /^\d+$/);
  assert.equal((await servicio("select * from public.reclamar_recordatorios_whatsapp()")).length, 0);
});

// --- Suscripciones y administración ----------------------------------------------------

const DIA = 86_400_000;
const msHasta = (fecha) => new Date(fecha).getTime() - Date.now();

await prueba("suscripción: el negocio nuevo arranca con 7 días de prueba y el dueño no puede tocarla", async () => {
  const s = await como("ana", async () => (await uno("select public.mi_suscripcion() as s")).s);
  assert.equal(s.estado, "prueba");
  assert.ok(msHasta(s.prueba_hasta) > 6.9 * DIA && msHasta(s.prueba_hasta) <= 7 * DIA, "7 días");
  assert.equal(s.pagado_hasta, null);
  await como("ana", async () => {
    for (const col of ["prueba_hasta", "pagado_hasta", "suspendido_at"]) {
      await falla(q(`update public.negocios set ${col} = now() + interval '1 year' where id = $1`, [negA]), /permission denied/, col);
    }
    await falla(q("update public.negocios set suspension_motivo = null where id = $1", [negA]), /permission denied/, "motivo");
    for (const t of ["plataforma.administradores", "plataforma.pagos", "plataforma.notas", "plataforma.auditoria"]) {
      await falla(q(`select * from ${t}`), /permission denied/, t);
    }
    await falla(q("insert into plataforma.administradores values ($1)", [USUARIOS.ana]), /permission denied/, "hacerse admin");
    assert.equal((await uno("select plataforma.es_admin() as a")).a, false);
  });
});

await prueba("suscripción: el estado sale de las fechas", async () => {
  const estado = async (prueba, pagado, suspendido) =>
    (await uno(
      `select plataforma.estado_suscripcion(now() + $1::interval, now() + $2::interval, now() + $3::interval) as e`,
      [prueba, pagado, suspendido],
    )).e;
  assert.equal(await estado("1 day", null, null), "prueba");
  assert.equal(await estado("-1 day", null, null), "gracia");
  assert.equal(await estado("-4 days -23 hours", null, null), "gracia");
  assert.equal(await estado("-5 days -1 hour", null, null), "vencida");
  assert.equal(await estado("-30 days", "1 day", null), "activa");
  assert.equal(await estado("1 day", "20 days", null), "activa");
  assert.equal(await estado("-60 days", "-2 days", null), "gracia");
  assert.equal(await estado("-60 days", "-6 days", null), "vencida");
  assert.equal(await estado("5 days", "30 days", "0 seconds"), "suspendida");
});

await prueba("suscripción: gracia = solo lectura con reservas; apagado = sin reservas; el cliente cancela y el cron sigue", async () => {
  const proximo = (await uno("select ($1::date + 7) as d", [lunes])).d;
  const hora = async (h) =>
    (await uno(`select (($1::date + $2::time) at time zone 'America/Argentina/Buenos_Aires') as t`, [proximo, h])).t;
  const reservado = await reservar(
    "select * from public.crear_reserva($1, $2, $3, $4, 'Sol', '1144001100', 'sol@mail.com')",
    [negA, servA, profAna, await hora("11:00")],
  );

  // Gracia (venció hace menos de 5 días): panel en solo lectura, la página sigue tomando reservas.
  await q("update public.negocios set prueba_hasta = now() - interval '1 day' where id = $1", [negA]);
  assert.equal((await como("ana", () => uno("select public.mi_suscripcion() as s"))).s.estado, "gracia");
  assert.equal(
    (await como("anon", () => uno("select public.negocio_publico('salon-ana') as d"))).d.reservas_habilitadas,
    true,
  );
  const enGracia = await reservar(
    "select * from public.crear_reserva($1, $2, $3, $4, 'Iris', '1144004400', 'iris@mail.com')",
    [negA, servA, profAna, await hora("14:00")],
  );
  assert.ok(enGracia.token, "reserva online en gracia");
  await como("ana", async () => {
    await falla(q("update public.servicios set nombre = 'Otro' where id = $1", [servA]), /NEGOCIO_NO_HABILITADO/, "servicio en gracia");
    await falla(
      q("select public.crear_turno_panel($1, $2, $3, 'Mar', '1144003300', null, null, null)", [profAna, servA, await hora("15:00")]),
      /NEGOCIO_NO_HABILITADO/,
      "turno desde el panel en gracia",
    );
  });
  await como("anon", () => q("select public.cancelar_turno_cliente($1)", [enGracia.token]));

  // Apagado (pasó la gracia): tampoco toma reservas.
  await q("update public.negocios set prueba_hasta = now() - interval '10 days' where id = $1", [negA]);

  assert.equal((await como("ana", () => uno("select public.mi_suscripcion() as s"))).s.estado, "vencida");
  const pub = await como("anon", async () => (await uno("select public.negocio_publico('salon-ana') as d")).d);
  assert.equal(pub.reservas_habilitadas, false);
  assert.ok(pub.servicios.length > 0, "el portal se sigue viendo");

  await falla(
    reservar("select * from public.crear_reserva($1, $2, $3, $4, 'Luz', '1144002200', 'luz@mail.com')", [
      negA, servA, profAna, await hora("12:00"),
    ]),
    /NEGOCIO_NO_HABILITADO/,
    "reserva online",
  );
  await como("ana", async () => {
    assert.ok((await q("select * from public.servicios")).length > 0, "lee igual");
    assert.ok((await q("select * from public.turnos")).length > 0, "lee igual");
    await falla(q("update public.servicios set nombre = 'Otro' where id = $1", [servA]), /NEGOCIO_NO_HABILITADO/, "servicio");
    await falla(q("update public.negocios set nombre = 'Otro' where id = $1", [negA]), /NEGOCIO_NO_HABILITADO/, "negocio");
    await falla(
      q("insert into public.bloqueos (negocio_id, profesional_id, inicio, fin) values ($1, $2, now(), now() + interval '1 hour')", [negA, profAna]),
      /NEGOCIO_NO_HABILITADO/,
      "bloqueo",
    );
    await falla(
      q("update public.turnos set estado = 'cancelado' where token_cancelacion = $1", [reservado.token]),
      /NEGOCIO_NO_HABILITADO/,
      "turno",
    );
    await falla(
      q("select public.crear_turno_panel($1, $2, $3, 'Mar', '1144003300', null, null, null)", [profAna, servA, await hora("13:00")]),
      /NEGOCIO_NO_HABILITADO/,
      "turno desde el panel",
    );
  });

  // El cliente puede cancelar su turno y el cron sigue andando.
  await como("anon", () => q("select public.cancelar_turno_cliente($1)", [reservado.token]));
  assert.equal((await uno("select estado from public.turnos where token_cancelacion = $1", [reservado.token])).estado, "cancelado");
  await servicio("select * from public.reclamar_recordatorios()");

  // Paga: vuelve a funcionar, por un mes desde hoy (la prueba ya había terminado).
  await como("admin", () => q("select plataforma.admin_registrar_pago($1, 15000, 'transferencia', 1, 'noviembre')", [negA]));
  const s = await como("ana", async () => (await uno("select public.mi_suscripcion() as s")).s);
  assert.equal(s.estado, "activa");
  assert.ok(msHasta(s.pagado_hasta) > 27 * DIA && msHasta(s.pagado_hasta) < 32 * DIA, "un mes");
  await como("ana", () => q("update public.servicios set nombre = 'Corte' where id = $1", [servA]));
  assert.equal((await como("anon", () => uno("select public.negocio_publico('salon-ana') as d"))).d.reservas_habilitadas, true);
});

await prueba("admin: solo un administrador usa sus funciones", async () => {
  const llamadas = [
    ["select * from plataforma.admin_negocios()", []],
    ["select plataforma.admin_negocio($1)", [negB]],
    ["select plataforma.admin_registrar_pago($1, 100, 'efectivo', 1, null)", [negB]],
    ["select plataforma.admin_extender_prueba($1, 30)", [negB]],
    ["select plataforma.admin_suspender($1, 'x')", [negB]],
    ["select plataforma.admin_reactivar($1)", [negB]],
    ["select plataforma.admin_agregar_nota($1, 'x')", [negB]],
    ["select plataforma.admin_cambiar_slug($1, 'robado')", [negB]],
    ["select plataforma.admin_registrar_accion('link_acceso_dueno', $1, '{}')", [negB]],
  ];
  for (const [sql, params] of llamadas) {
    for (const u of ["ana", "beto", "eva", "nadie"]) {
      await como(u, () => falla(q(sql, params), /SIN_PERMISO/, `${u}: ${sql}`));
    }
    for (const u of ["anon", "servidor"]) {
      await como(u, () => falla(q(sql, params), /permission denied/, `${u}: ${sql}`));
    }
  }
  const neg = await uno("select prueba_hasta, pagado_hasta, suspendido_at, slug from public.negocios where id = $1", [negB]);
  assert.equal(neg.pagado_hasta, null);
  assert.equal(neg.suspendido_at, null);
  assert.equal(neg.slug, "barberia-beto");
  assert.equal((await q("select * from plataforma.auditoria where negocio_id = $1", [negB])).length, 0);
});

await prueba("admin: lista y detalle sin datos de clientes ni precios", async () => {
  const lista = await como("admin", () => q("select * from plataforma.admin_negocios()"));
  const a = lista.find((n) => n.id === negA);
  assert.equal(a.dueno_email, "ana@test.com");
  assert.equal(a.estado, "activa");
  assert.ok(a.profesionales >= 1);
  assert.equal(lista.find((n) => n.id === negB).estado, "prueba");

  const d = await como("admin", async () => (await uno("select plataforma.admin_negocio($1) as d", [negA])).d);
  assert.equal(d.slug, "salon-ana");
  assert.ok(d.equipo.some((u) => u.email === "ana@test.com" && u.rol === "dueno"));
  assert.ok(d.profesionales.length > 0 && d.servicios.length > 0);
  assert.ok(d.uso.clientes > 0);
  assert.equal(d.pagos.length, 1);
  const texto = JSON.stringify(d);
  for (const prohibido of ["lucia@mail.com", "Lucía", "1155551234", "sol@mail.com", "precio", "token"]) {
    assert.ok(!texto.includes(prohibido), `el detalle no muestra ${prohibido}`);
  }
  await como("admin", () => falla(q("select plataforma.admin_negocio($1)", [USUARIOS.nadie]), /NO_ENCONTRADO/, "inexistente"));

  // Último ingreso: lo anota la base al abrirse la sesión y queda aunque se cierre.
  await como("auth", () =>
    q(`insert into auth."session" ("expiresAt", "token", "updatedAt", "userId") values (now() + interval '1 day', 'tok-ana', now(), $1)`, [USUARIOS.ana]),
  );
  await como("auth", () => q(`delete from auth."session" where "token" = 'tok-ana'`));
  const tras = await como("admin", async () => (await uno("select plataforma.admin_negocio($1) as d", [negA])).d);
  const ana = tras.equipo.find((u) => u.email === "ana@test.com");
  assert.ok(ana.ultimo_ingreso && Date.now() - new Date(ana.ultimo_ingreso).getTime() < 60_000, "último ingreso");
  const fila = (await como("admin", () => q("select * from plataforma.admin_negocios()"))).find((n) => n.id === negA);
  assert.ok(fila.ultimo_ingreso, "último ingreso en la lista");
  await como("ana", () => falla(q("select * from plataforma.ultimos_ingresos"), /permission denied/, "dueña"));
});

await prueba("admin: pagos encadenados, anulación, prueba, suspensión, notas, slug y auditoría", async () => {
  const admin = (sql, params) => como("admin", () => uno(sql, params));
  const negocio = () => uno("select * from public.negocios where id = $1", [negB]);
  const { prueba_hasta } = await negocio();

  // Pagar durante la prueba no hace perder días: arranca cuando termina la prueba.
  const p1 = (await admin("select plataforma.admin_registrar_pago($1, 15000, 'efectivo', 1, null) as id", [negB])).id;
  const tras1 = (await negocio()).pagado_hasta;
  assert.equal(
    (await uno("select ($1::timestamptz + interval '1 month') = $2::timestamptz as ok", [prueba_hasta, tras1])).ok,
    true,
  );
  // El siguiente sigue desde donde terminó el anterior.
  const p2 = (await admin("select plataforma.admin_registrar_pago($1, 28000, 'transferencia', 2, 'dic y ene') as id", [negB])).id;
  assert.equal(
    (await uno("select ($1::timestamptz + interval '2 months') = $2::timestamptz as ok", [tras1, (await negocio()).pagado_hasta])).ok,
    true,
  );
  await como("admin", () => falla(q("select plataforma.admin_registrar_pago($1, 0, 'efectivo', 1, null)", [negB]), /check/, "monto 0"));
  await como("admin", () => falla(q("select plataforma.admin_registrar_pago($1, 10, 'cripto', 1, null)", [negB]), /check/, "medio"));

  // Anular el segundo vuelve al vencimiento del primero.
  await como("admin", () => falla(q("select plataforma.admin_anular_pago($1, ' ')", [p2]), /FALTA_MOTIVO/, "sin motivo"));
  await admin("select plataforma.admin_anular_pago($1, 'cargado dos veces')", [p2]);
  assert.equal((await uno("select $1::timestamptz = $2::timestamptz as ok", [tras1, (await negocio()).pagado_hasta])).ok, true);
  await como("admin", () => falla(q("select plataforma.admin_anular_pago($1, 'otra vez')", [p2]), /NO_ENCONTRADO/, "ya anulado"));
  await admin("select plataforma.admin_anular_pago($1, 'prueba')", [p1]);
  assert.equal((await negocio()).pagado_hasta, null);

  // Suspensión: el dueño queda en solo lectura aunque esté en prueba.
  await admin("select plataforma.admin_suspender($1, 'no pagó')", [negB]);
  assert.equal((await como("beto", () => uno("select public.mi_suscripcion() as s"))).s.estado, "suspendida");
  await como("beto", () =>
    falla(q("update public.negocios set nombre = 'X' where id = $1", [negB]), /NEGOCIO_NO_HABILITADO/, "suspendido"),
  );
  await admin("select plataforma.admin_reactivar($1)", [negB]);
  await como("beto", () => q("update public.negocios set nombre = 'Barbería Beto' where id = $1", [negB]));

  await como("admin", () => falla(q("select plataforma.admin_extender_prueba($1, 0)", [negB]), /DIAS_INVALIDOS/, "0 días"));
  await admin("select plataforma.admin_extender_prueba($1, 10)", [negB]);
  assert.ok(msHasta((await negocio()).prueba_hasta) > 16.9 * DIA, "7 + 10 días");

  // Terminar la prueba: el pago que esperaba detrás de la prueba se adelanta a hoy.
  const p3 = (await admin("select plataforma.admin_registrar_pago($1, 15000, 'efectivo', 1, null) as id", [negB])).id;
  assert.ok(msHasta((await negocio()).pagado_hasta) > 40 * DIA, "encolado detrás de la prueba");
  await como("beto", () => falla(q("select plataforma.admin_terminar_prueba($1)", [negB]), /SIN_PERMISO/, "dueño"));
  await admin("select plataforma.admin_terminar_prueba($1)", [negB]);
  const trasTerminar = await negocio();
  assert.ok(msHasta(trasTerminar.prueba_hasta) <= 0, "la prueba terminó");
  assert.ok(msHasta(trasTerminar.pagado_hasta) > 27 * DIA && msHasta(trasTerminar.pagado_hasta) < 32 * DIA, "un mes desde hoy");
  const pago3 = await uno("select periodo_desde, periodo_hasta from plataforma.pagos where id = $1", [p3]);
  assert.ok(Math.abs(msHasta(pago3.periodo_desde)) < 60_000, "el pago arranca hoy");
  assert.equal((await como("beto", () => uno("select public.mi_suscripcion() as s"))).s.estado, "activa");
  await como("admin", () => falla(q("select plataforma.admin_terminar_prueba($1)", [negB]), /SIN_PRUEBA/, "ya terminada"));
  await admin("select plataforma.admin_anular_pago($1, 'prueba')", [p3]);
  await admin("select plataforma.admin_extender_prueba($1, 10)", [negB]);

  await como("admin", () => falla(q("select plataforma.admin_cambiar_slug($1, 'salon-ana')", [negB]), /SLUG_OCUPADO/, "ocupado"));
  await admin("select plataforma.admin_cambiar_slug($1, 'barberia-beto-2')", [negB]);
  await admin("select plataforma.admin_cambiar_slug($1, 'barberia-beto')", [negB]);

  await admin("select plataforma.admin_agregar_nota($1, 'Llamó por los horarios')", [negB]);
  await admin("select plataforma.admin_registrar_accion('link_acceso_dueno', $1, '{}')", [negB]);
  await admin(`select plataforma.admin_registrar_accion('aviso_whatsapp', $1, '{"estado": "prueba"}')`, [negB]);
  await como("admin", () =>
    falla(q("select plataforma.admin_registrar_accion('borrar_todo', $1, '{}')", [negB]), /ACCION_INVALIDA/, "acción libre"),
  );

  const d = await como("admin", async () => (await uno("select plataforma.admin_negocio($1) as d", [negB])).d);
  assert.equal(d.notas[0].texto, "Llamó por los horarios");
  assert.equal(d.pagos.length, 3);
  assert.ok(d.pagos.every((p) => p.anulado_at));
  assert.deepEqual(
    d.auditoria.map((a) => a.accion).reverse(),
    [
      "registrar_pago", "registrar_pago", "anular_pago", "anular_pago", "suspender", "reactivar",
      "extender_prueba", "registrar_pago", "terminar_prueba", "anular_pago", "extender_prueba",
      "cambiar_slug", "cambiar_slug", "agregar_nota", "link_acceso_dueno", "aviso_whatsapp",
    ],
  );
  assert.ok(d.auditoria.every((a) => a.admin === "admin"));
});

await prueba("avisos: el cron reclama cada aviso de vencimiento una sola vez por ciclo", async () => {
  const reclamar = async () =>
    (await servicio("select * from plataforma.reclamar_avisos_suscripcion()")).filter((a) => a.negocio_id === negB);
  const fijarPrueba = (intervalo) =>
    q("update public.negocios set prueba_hasta = now() + $2::interval, pagado_hasta = null where id = $1", [negB, intervalo]);

  await fijarPrueba("10 days");
  assert.deepEqual(await reclamar(), [], "lejos del vencimiento");

  await fijarPrueba("2 days");
  const [porVencer] = await reclamar();
  assert.equal(porVencer.tipo, "por_vencer");
  assert.equal(porVencer.dueno_email, "beto@test.com");
  assert.deepEqual(await reclamar(), [], "no se repite");

  await fijarPrueba("-1 day");
  assert.deepEqual((await reclamar()).map((a) => a.tipo), ["vencio"]);
  await fijarPrueba("-6 days");
  assert.deepEqual((await reclamar()).map((a) => a.tipo), ["bloqueado"]);
  await fijarPrueba("-40 days");
  assert.deepEqual(await reclamar(), [], "vencido hace mucho: no se le escribe");

  // Nuevo ciclo (otra fecha de vencimiento): los avisos vuelven a salir.
  await fijarPrueba("1 day");
  const [nuevo] = await reclamar();
  assert.equal(nuevo.tipo, "por_vencer");
  // Si el mail falla, el cron desmarca el aviso y sale en la corrida siguiente.
  await servicio("delete from plataforma.avisos_suscripcion where negocio_id = $1 and tipo = $2 and vence = $3", [
    negB, nuevo.tipo, nuevo.vence,
  ]);
  assert.deepEqual((await reclamar()).map((a) => a.tipo), ["por_vencer"], "reintento");
  await como("servidor", () =>
    falla(q("insert into plataforma.avisos_suscripcion (negocio_id, tipo, vence) values ($1, 'vencio', now())", [negB]), /permission denied/, "servidor inserta"),
  );
  await como("servidor", () => falla(q("select * from plataforma.pagos"), /permission denied/, "servidor lee pagos"));

  await como("ana", () =>
    falla(q("select * from plataforma.reclamar_avisos_suscripcion()"), /permission denied/, "dueña"),
  );

  // Prueba: el aviso sale recién en los últimos 2 días.
  await fijarPrueba("3 days");
  assert.deepEqual(await reclamar(), [], "prueba a 3 días");

  // Plan pago: el aviso sale 4 días antes (el día 26 de un mes de 30).
  const fijarPago = (intervalo) =>
    q("update public.negocios set prueba_hasta = now() - interval '60 days', pagado_hasta = now() + $2::interval where id = $1", [
      negB, intervalo,
    ]);
  await fijarPago("5 days");
  assert.deepEqual(await reclamar(), [], "plan a 5 días");
  await fijarPago("3 days 23 hours");
  const [plan] = await reclamar();
  assert.equal(plan.tipo, "por_vencer");
  assert.equal(plan.estado, "activa");
  await fijarPrueba("20 days");
});

await prueba("logo: solo el servidor lee y escribe los logos; tamaño y tipo acotados", async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  await servicio("insert into public.negocio_logos (negocio_id, tipo, datos) values ($1, 'image/png', $2)", [negA, png]);
  for (const quien of ["ana", "beto", "eva", "anon", "app"]) {
    await como(quien, () => falla(q("select * from public.negocio_logos"), /permission denied/, `${quien} lee`));
    await como(quien, () =>
      falla(q("insert into public.negocio_logos (negocio_id, tipo, datos) values ($1, 'image/png', $2)", [negB, png]), /permission denied/, `${quien} escribe`),
    );
  }
  await falla(
    servicio("update public.negocio_logos set tipo = 'image/svg+xml' where negocio_id = $1", [negA]),
    /check constraint/,
    "svg",
  );
  await falla(
    servicio("update public.negocio_logos set datos = decode(repeat('00', 524289), 'hex') where negocio_id = $1", [negA]),
    /check constraint/,
    "más de 512 KB",
  );
  const [fila] = await servicio("select octet_length(datos) as n from public.negocio_logos where negocio_id = $1", [negA]);
  assert.equal(fila.n, 10);
  await servicio("delete from public.negocio_logos where negocio_id = $1", [negA]);
});

// --- Productos y tienda (0020; antes de borrar a Eva, que hace de empleada) ----------------

await prueba("productos: la dueña hace ABM, la empleada solo lee, otro negocio no ve nada, anon nada", async () => {
  const p = await como("ana", () => uno("insert into public.productos (negocio_id, nombre, precio, stock) values ($1, 'Cera mate', 8500, 5) returning id", [negA]));
  await como("ana", () => q("update public.productos set stock = 4 where id = $1", [p.id]));
  assert.equal((await como("eva", () => q("select id from public.productos"))).length, 1);
  await como("eva", () => falla(q("update public.productos set precio = 1 where id = $1 returning id", [p.id]).then((r) => { if (!r.length) throw new Error("sin filas"); }), /sin filas|permission denied/, "empleada edita"));
  assert.equal((await como("beto", () => q("select id from public.productos"))).length, 0);
  await como("anon", () => falla(q("select * from public.productos"), /permission denied/, "anon lee productos"));
  await como("ana", () => falla(q("select * from public.producto_fotos"), /permission denied/, "dueña lee fotos directo"));
  await como("ana", () => falla(q("insert into public.productos (negocio_id, nombre, precio, stock) values ($1, 'X', 10, -1)", [negA]), /check/, "stock negativo"));
});

await prueba("tienda: la dueña configura medios y transferencia; valores inválidos se rechazan", async () => {
  await como("ana", () => q("update public.negocios set tienda_activa = true, tienda_medios = '{efectivo,transferencia}', transferencia_alias = 'peluqueria.ana', transferencia_titular = 'Ana Test' where id = $1", [negA]));
  await como("ana", () => falla(q("update public.negocios set tienda_medios = '{bitcoin}' where id = $1", [negA]), /check/, "medio inválido"));
  await como("ana", () => falla(q("update public.negocios set transferencia_cbu = '123' where id = $1", [negA]), /check/, "cbu inválido"));
  await como("eva", () => q("update public.negocios set tienda_activa = false where id = $1", [negA]));
  assert.equal((await uno("select tienda_activa from public.negocios where id = $1", [negA])).tienda_activa, true, "la empleada no cambia la tienda");
});

// --- Pedidos (0021; también antes de borrar a Eva) -------------------------------------------

const pedir = (items, nombre, email, medio, turnoToken = null, negocio = negA) =>
  como("servidor", () =>
    uno("select * from public.crear_pedido($1, $2::jsonb, $3, $4, null, $5, $6)", [negocio, JSON.stringify(items), nombre, email, medio, turnoToken]),
  );
const stockDe = async (id) => (await uno("select stock from public.productos where id = $1", [id])).stock;
const pedidoDe = (id) => uno("select * from public.pedidos where id = $1", [id]);

await prueba("pedidos: crear aparta stock, valida medios, límites y no vende de más", async () => {
  const prod = await como("ana", () => uno("insert into public.productos (negocio_id, nombre, precio, stock) values ($1, 'Shampoo', 5000, 2) returning id", [negA]));
  const items = JSON.stringify([{ producto_id: prod.id, cantidad: 2 }]);
  const p1 = await como("servidor", () => uno("select * from public.crear_pedido($1, $2::jsonb, 'Juan Pérez', 'juan@test.com', '1155550101', 'efectivo')", [negA, items]));
  assert.equal(Number(p1.total), 10000);
  assert.equal(p1.numero, 1);
  assert.match(p1.token, /^[0-9a-f]{64}$/);
  assert.equal((await uno("select stock from public.productos where id = $1", [prod.id])).stock, 0);
  const guardado = await pedidoDe(p1.pedido_id);
  assert.equal(guardado.estado, "pendiente");
  assert.equal(guardado.telefono, "1155550101");
  const item = await uno("select nombre, precio_unitario, cantidad from public.pedido_items where pedido_id = $1", [p1.pedido_id]);
  assert.deepEqual({ ...item, precio_unitario: Number(item.precio_unitario) }, { nombre: "Shampoo", precio_unitario: 5000, cantidad: 2 });
  await como("servidor", () => falla(q("select * from public.crear_pedido($1, $2::jsonb, 'Otra', 'otra@test.com', null, 'efectivo')", [negA, JSON.stringify([{ producto_id: prod.id, cantidad: 1 }])]), /SIN_STOCK/, "sin stock"));
  // Mercado Pago habilitado en la tienda pero sin la integración activa.
  await q("update public.negocios set tienda_medios = '{efectivo,transferencia,mercadopago}' where id = $1", [negA]);
  await q("update public.integraciones set estado = 'inactiva' where negocio_id = $1 and proveedor = 'mercadopago'", [negA]);
  await como("servidor", () => falla(q("select * from public.crear_pedido($1, $2::jsonb, 'Juan', 'juan@test.com', null, 'mercadopago')", [negA, items]), /TIENDA_NO_DISPONIBLE/, "MP no conectado"));
  await como("anon", () => falla(q("select * from public.crear_pedido($1, $2::jsonb, 'X', 'x@test.com', null, 'efectivo')", [negA, items]), /permission denied/, "anon"));
  await como("ana", () => falla(q("select * from public.crear_pedido($1, $2::jsonb, 'X', 'x@test.com', null, 'efectivo')", [negA, items]), /permission denied/, "panel"));
  // Datos inválidos: sin items, cantidad fuera de rango, producto repetido, mail malo, medio inexistente.
  for (const [it, mail, medio] of [
    [[], "x@test.com", "efectivo"],
    [[{ producto_id: prod.id, cantidad: 21 }], "x@test.com", "efectivo"],
    [[{ producto_id: prod.id, cantidad: 1 }, { producto_id: prod.id, cantidad: 1 }], "x@test.com", "efectivo"],
    [[{ producto_id: "no-es-uuid", cantidad: 1 }], "x@test.com", "efectivo"],
    [[{ producto_id: prod.id, cantidad: 1 }], "sin-arroba", "efectivo"],
    [[{ producto_id: prod.id, cantidad: 1 }], "x@test.com", "bitcoin"],
  ]) {
    await falla(pedir(it, "Xavier", mail, medio), /DATOS_INVALIDOS/, `inválido ${JSON.stringify(it)} ${mail} ${medio}`);
  }
  // Un producto de otro negocio no se vende acá.
  const deBeto = await uno("insert into public.productos (negocio_id, nombre, precio, stock) values ($1, 'Ajeno', 100, 5) returning id", [negB]);
  await falla(pedir([{ producto_id: deBeto.id, cantidad: 1 }], "Xavier", "x@test.com", "efectivo"), /SIN_STOCK/, "producto ajeno");
  assert.equal(await stockDe(deBeto.id), 5);
  await q("delete from public.productos where id = $1", [deBeto.id]);
  // vencimiento de efectivo: 3 días
  const v = await uno("select round(extract(epoch from vence_at - created_at) / 86400) as d from public.pedidos where id = $1", [p1.pedido_id]);
  assert.equal(Number(v.d), 3);
  // límite: 3 pendientes por mail (con alias +x cuenta igual)
  await q("update public.productos set stock = 10 where id = $1", [prod.id]);
  const uno1 = JSON.stringify([{ producto_id: prod.id, cantidad: 1 }]);
  for (const mail of ["juan+a@test.com", "juan+b@test.com"]) await como("servidor", () => q("select * from public.crear_pedido($1, $2::jsonb, 'Juan', $3, null, 'efectivo')", [negA, uno1, mail]));
  await como("servidor", () => falla(q("select * from public.crear_pedido($1, $2::jsonb, 'Juan', 'juan@test.com', null, 'efectivo')", [negA, uno1]), /LIMITE_PEDIDOS/, "4to pendiente"));
  assert.equal(await stockDe(prod.id), 8, "el pedido rechazado no descuenta");
  // Con Mercado Pago activo: 30 minutos para pagar.
  await q("update public.integraciones set estado = 'activa' where negocio_id = $1 and proveedor = 'mercadopago'", [negA]);
  const mp = await pedir([{ producto_id: prod.id, cantidad: 1 }], "Mia", "mia@test.com", "mercadopago");
  const m = await uno("select round(extract(epoch from vence_at - created_at) / 60) as min from public.pedidos where id = $1", [mp.pedido_id]);
  assert.equal(Number(m.min), 30);
  assert.equal(mp.numero, 4);
  await q("update public.negocios set tienda_medios = '{efectivo,transferencia}' where id = $1", [negA]);
});

await prueba("pedidos: vencer devuelve stock; pago tardío reaparta o queda a reembolsar; idempotente", async () => {
  const prod = await como("ana", () => uno("insert into public.productos (negocio_id, nombre, precio, stock) values ($1, 'Gel', 3000, 1) returning id", [negA]));
  const uno1 = [{ producto_id: prod.id, cantidad: 1 }];
  const pA = await pedir(uno1, "Tardío", "tardio@test.com", "transferencia");
  const h = await uno("select round(extract(epoch from vence_at - created_at) / 3600) as h from public.pedidos where id = $1", [pA.pedido_id]);
  assert.equal(Number(h.h), 48, "transferencia: 48 horas");
  assert.equal(await stockDe(prod.id), 0);

  // Vence: vuelve el stock, una sola vez.
  await q("update public.pedidos set vence_at = now() - interval '1 minute' where id = $1", [pA.pedido_id]);
  await como("anon", () => falla(q("select public.liberar_pedidos_vencidos()"), /permission denied/, "anon libera"));
  assert.equal((await servicio("select public.liberar_pedidos_vencidos() as n"))[0].n, 1);
  assert.equal((await servicio("select public.liberar_pedidos_vencidos() as n"))[0].n, 0);
  const vencido = await pedidoDe(pA.pedido_id);
  assert.deepEqual({ estado: vencido.estado, por: vencido.cancelado_por }, { estado: "vencido", por: "sistema" });
  assert.equal(await stockDe(prod.id), 1);

  // Pago tardío con stock: se vuelve a apartar y queda pagado.
  const pagar = async (id, pago, aprobado, monto) =>
    (await servicio("select public.registrar_pago_pedido($1, $2, $3, $4) as r", [id, pago, aprobado, monto]))[0].r;
  assert.equal(await pagar(pA.pedido_id, "pp1", true, 3000), "confirmado");
  const pagado = await pedidoDe(pA.pedido_id);
  assert.equal(pagado.estado, "pagado");
  assert.equal(pagado.pago_id, "pp1");
  assert.ok(pagado.pagado_at);
  assert.equal(await stockDe(prod.id), 0);
  // El webhook y la vuelta del cliente: el segundo no descuenta de nuevo.
  assert.equal(await pagar(pA.pedido_id, "pp1", true, 3000), "ya_procesado");
  assert.equal(await stockDe(prod.id), 0);

  // Otro pago aprobado con el pedido ya pagado: queda anotado para devolver, una sola vez.
  assert.equal(await pagar(pA.pedido_id, "pp9", false, 3000), "ya_procesado", "otro rechazado no importa");
  assert.equal(await pagar(pA.pedido_id, "pp9", true, 3000), "duplicado");
  assert.equal((await pedidoDe(pA.pedido_id)).pago_duplicado_id, "pp9");
  assert.equal(await pagar(pA.pedido_id, "pp9", true, 3000), "ya_procesado", "el mismo duplicado dos veces");
  const dup = await pedidoDe(pA.pedido_id);
  assert.deepEqual({ e: dup.estado, pago: dup.pago_id }, { e: "pagado", pago: "pp1" });
  assert.equal(await stockDe(prod.id), 0);
  for (const u of ["eva", "beto"]) {
    await como(u, () => falla(q("select public.pedido_duplicado_devuelto($1)", [pA.pedido_id]), /SIN_PERMISO/, `${u} limpia el duplicado`));
  }
  await como("anon", () => falla(q("select public.pedido_duplicado_devuelto($1)", [pA.pedido_id]), /permission denied/, "anon"));
  await como("servidor", () => falla(q("select public.pedido_duplicado_devuelto($1)", [pA.pedido_id]), /permission denied/, "servidor"));
  await como("ana", () => q("select public.pedido_duplicado_devuelto($1)", [pA.pedido_id]));
  assert.equal((await pedidoDe(pA.pedido_id)).pago_duplicado_id, null);
  await como("ana", () => falla(q("select public.pedido_duplicado_devuelto($1)", [pA.pedido_id]), /ESTADO_INVALIDO/, "sin duplicado"));

  // Pago tardío sin stock: a reembolsar, sin tocar el stock.
  await q("update public.productos set stock = 1 where id = $1", [prod.id]);
  const pB = await pedir(uno1, "Lento", "lento@test.com", "transferencia");
  await q("update public.pedidos set vence_at = now() - interval '1 minute' where id = $1", [pB.pedido_id]);
  const pC = await pedir(uno1, "Rápido", "rapido@test.com", "transferencia"); // libera el vencido y se lo queda
  assert.equal((await pedidoDe(pB.pedido_id)).estado, "vencido");
  assert.equal(await stockDe(prod.id), 0);
  assert.equal(await pagar(pB.pedido_id, "pp2", true, 3000), "reembolsar");
  assert.equal((await pedidoDe(pB.pedido_id)).estado, "reembolsar");
  assert.equal((await pedidoDe(pB.pedido_id)).vence_at, null, "a reembolsar no tiene plazo");
  assert.equal(await stockDe(prod.id), 0);
  assert.equal(await pagar(pB.pedido_id, "pp2", true, 3000), "ya_procesado");

  // Rechazado: sin cambios. Monto menor: a reembolsar y el stock vuelve.
  assert.equal(await pagar(pC.pedido_id, "pp3", false, 3000), "rechazado");
  assert.equal((await pedidoDe(pC.pedido_id)).estado, "pendiente");
  assert.equal(await pagar(pC.pedido_id, "pp4", true, 100), "reembolsar");
  assert.equal((await pedidoDe(pC.pedido_id)).estado, "reembolsar");
  assert.equal(await stockDe(prod.id), 1);

  // La dueña lo marca como devuelto: cancelado, el stock no cambia, y el mismo pago no lo revive.
  await como("ana", () => q("select public.pedido_marcar_devuelto($1)", [pC.pedido_id]));
  assert.equal((await pedidoDe(pC.pedido_id)).estado, "cancelado");
  assert.equal(await stockDe(prod.id), 1);
  assert.equal(await pagar(pC.pedido_id, "pp4", true, 3000), "ya_procesado");
  assert.equal(await stockDe(prod.id), 1);
  assert.equal(await pagar("00000000-0000-4000-8000-000000000000", "pp5", true, 1), "rechazado");
  await como("ana", () => falla(q("select public.registrar_pago_pedido($1, 'x', true, 1)", [pC.pedido_id]), /permission denied/, "dueña"));
});

await prueba("pedidos: pago tardío revive solo lo vencido o cancelado por el cliente; lo cancelado por el negocio va a reembolsar", async () => {
  const prod = await como("ana", () => uno("insert into public.productos (negocio_id, nombre, precio, stock) values ($1, 'Tónico', 2000, 5) returning id", [negA]));
  const uno1 = [{ producto_id: prod.id, cantidad: 1 }];
  const pagar = async (id, pago) =>
    (await servicio("select public.registrar_pago_pedido($1, $2, true, 2000) as r", [id, pago]))[0].r;

  // Cancelado por el negocio: el pago no lo revive ni toca el stock.
  const pN = await pedir(uno1, "Nora", "nora@test.com", "transferencia");
  await como("ana", () => q("select public.pedido_cancelar($1)", [pN.pedido_id]));
  assert.equal(await stockDe(prod.id), 5);
  assert.equal(await pagar(pN.pedido_id, "pn1"), "reembolsar");
  const n = await pedidoDe(pN.pedido_id);
  assert.deepEqual({ e: n.estado, vence: n.vence_at, pago: n.pago_id }, { e: "reembolsar", vence: null, pago: "pn1" });
  assert.equal(await stockDe(prod.id), 5, "no aparta stock");
  // Devuelto por la dueña: un pago nuevo tampoco lo revive.
  await como("ana", () => q("select public.pedido_marcar_devuelto($1)", [pN.pedido_id]));
  assert.equal((await pedidoDe(pN.pedido_id)).cancelado_por, "negocio");
  assert.equal(await pagar(pN.pedido_id, "pn2"), "reembolsar");
  assert.equal(await stockDe(prod.id), 5);

  // Cancelado por el cliente: el pago tardío lo revive si hay stock.
  const pK = await pedir(uno1, "Kevin", "kevin@test.com", "transferencia");
  assert.equal((await servicio("select public.cancelar_pedido_cliente($1) as r", [pK.token]))[0].r, true);
  assert.equal(await stockDe(prod.id), 5);
  assert.equal(await pagar(pK.pedido_id, "pk1"), "confirmado");
  const k = await pedidoDe(pK.pedido_id);
  assert.deepEqual({ e: k.estado, por: k.cancelado_por }, { e: "pagado", por: null });
  assert.equal(await stockDe(prod.id), 4);
});

await prueba("pedidos: el cron devuelve el stock de varios vencidos de una vez, con tope en 100000", async () => {
  const a = await como("ana", () => uno("insert into public.productos (negocio_id, nombre, precio, stock) values ($1, 'Cepillo', 1000, 10) returning id", [negA]));
  const b = await como("ana", () => uno("insert into public.productos (negocio_id, nombre, precio, stock) values ($1, 'Toalla', 1000, 10) returning id", [negA]));
  const p1 = await pedir([{ producto_id: a.id, cantidad: 2 }, { producto_id: b.id, cantidad: 3 }], "Uno", "uno@test.com", "efectivo");
  const p2 = await pedir([{ producto_id: b.id, cantidad: 1 }, { producto_id: a.id, cantidad: 4 }], "Dos", "dos@test.com", "efectivo");
  assert.equal(await stockDe(a.id), 4);
  assert.equal(await stockDe(b.id), 6);
  // La dueña sube el stock de uno al máximo mientras tanto.
  await como("ana", () => q("update public.productos set stock = 99999 where id = $1", [b.id]));
  await q("update public.pedidos set vence_at = now() - interval '1 minute' where id = any($1::uuid[])", [[p1.pedido_id, p2.pedido_id]]);
  assert.equal((await servicio("select public.liberar_pedidos_vencidos() as n"))[0].n, 2);
  assert.equal(await stockDe(a.id), 10);
  assert.equal(await stockDe(b.id), 100000, "con tope");
  for (const p of [p1, p2]) assert.equal((await pedidoDe(p.pedido_id)).estado, "vencido");
  await q("delete from public.productos where id = any($1::uuid[])", [[a.id, b.id]]);
});

await prueba("pedidos: panel solo para dueños; cancelar devuelve stock; cliente cancela por token", async () => {
  const prod = await como("ana", () => uno("insert into public.productos (negocio_id, nombre, precio, stock) values ($1, 'Peine', 1500, 3) returning id", [negA]));
  const uno1 = [{ producto_id: prod.id, cantidad: 1 }];
  const pP = await pedir(uno1, "Pablo", "pablo@test.com", "efectivo");
  assert.equal(await stockDe(prod.id), 2);

  for (const u of ["eva", "beto", "nadie"]) {
    await como(u, async () => {
      assert.equal((await q("select * from public.pedidos")).length, 0, `${u} ve pedidos`);
      assert.equal((await q("select * from public.pedido_items")).length, 0, `${u} ve items`);
      await falla(q("select public.pedido_marcar_pagado($1)", [pP.pedido_id]), /SIN_PERMISO/, `${u} marca pagado`);
      await falla(q("select public.pedido_cancelar($1)", [pP.pedido_id]), /SIN_PERMISO/, `${u} cancela`);
    });
  }
  await como("ana", async () => {
    assert.ok((await q("select * from public.pedidos")).length > 0);
    assert.ok((await q("select * from public.pedido_items where pedido_id = $1", [pP.pedido_id])).length === 1);
    await falla(q("update public.pedidos set estado = 'pagado' where id = $1", [pP.pedido_id]), /permission denied/, "update directo");
    await falla(q("delete from public.pedidos where id = $1", [pP.pedido_id]), /permission denied/, "delete directo");
  });

  // Pagado → entregado; el stock ya se había descontado.
  await como("ana", () => q("select public.pedido_marcar_pagado($1)", [pP.pedido_id]));
  const pagado = await pedidoDe(pP.pedido_id);
  assert.equal(pagado.estado, "pagado");
  assert.equal(pagado.vence_at, null);
  // Marcado como pagado a mano y después entra un pago de Mercado Pago: duplicado.
  assert.equal((await servicio("select public.registrar_pago_pedido($1, 'pm1', true, 1500) as r", [pP.pedido_id]))[0].r, "duplicado");
  assert.equal((await pedidoDe(pP.pedido_id)).pago_duplicado_id, "pm1");
  await como("ana", () => q("select public.pedido_marcar_entregado($1)", [pP.pedido_id]));
  assert.equal((await pedidoDe(pP.pedido_id)).estado, "entregado");
  await como("ana", () => falla(q("select public.pedido_cancelar($1)", [pP.pedido_id]), /ESTADO_INVALIDO/, "cancelar entregado"));
  assert.equal(await stockDe(prod.id), 2);

  // Entregado directo desde pendiente: queda con pagado_at.
  const pE = await pedir(uno1, "Eli", "eli@test.com", "efectivo");
  await como("ana", () => q("select public.pedido_marcar_entregado($1)", [pE.pedido_id]));
  const entregado = await pedidoDe(pE.pedido_id);
  assert.ok(entregado.pagado_at && entregado.entregado_at);
  assert.equal(await stockDe(prod.id), 1);

  // Cancelar uno pagado devuelve el stock.
  const pQ = await pedir(uno1, "Quique", "quique@test.com", "efectivo");
  assert.equal(await stockDe(prod.id), 0);
  await como("ana", () => q("select public.pedido_marcar_pagado($1)", [pQ.pedido_id]));
  await como("ana", () => q("select public.pedido_cancelar($1)", [pQ.pedido_id]));
  const cancelado = await pedidoDe(pQ.pedido_id);
  assert.deepEqual({ e: cancelado.estado, por: cancelado.cancelado_por }, { e: "cancelado", por: "negocio" });
  assert.equal(await stockDe(prod.id), 1);
  await como("ana", () => falla(q("select public.pedido_cancelar($1)", [pQ.pedido_id]), /ESTADO_INVALIDO/, "cancelar dos veces"));
  assert.equal(await stockDe(prod.id), 1);

  // Vencido marcado como pagado: lo vuelve a apartar, o SIN_STOCK si no hay.
  const pV = await pedir(uno1, "Vero", "vero@test.com", "efectivo");
  await q("update public.pedidos set vence_at = now() - interval '1 minute' where id = $1", [pV.pedido_id]);
  // ver_pedido muestra 'vencido' aunque el cron todavía no pasó.
  const visto = (await servicio("select public.ver_pedido($1) as d", [pV.token]))[0].d;
  assert.equal(visto.estado, "vencido");
  assert.equal(visto.numero, pV.numero);
  assert.equal(visto.items.length, 1);
  assert.equal(visto.items[0].nombre, "Peine");
  assert.equal(visto.negocio.slug, "salon-ana");
  assert.equal(visto.negocio.transferencia_alias, "peluqueria.ana");
  assert.ok(!("pago_id" in visto), "no muestra el pago");
  assert.equal(visto.turno, null);
  assert.equal((await servicio("select public.ver_pedido('no-existe') as d"))[0].d, null);
  await como("anon", () => falla(q("select public.ver_pedido($1)", [pV.token]), /permission denied/, "anon ve pedido"));
  await servicio("select public.liberar_pedidos_vencidos()");
  assert.equal(await stockDe(prod.id), 1);
  await q("update public.productos set stock = 0 where id = $1", [prod.id]);
  await como("ana", () => falla(q("select public.pedido_marcar_pagado($1)", [pV.pedido_id]), /SIN_STOCK/, "vencido sin stock"));
  assert.equal((await pedidoDe(pV.pedido_id)).estado, "vencido");
  await q("update public.productos set stock = 1 where id = $1", [prod.id]);
  await como("ana", () => q("select public.pedido_marcar_pagado($1)", [pV.pedido_id]));
  assert.equal((await pedidoDe(pV.pedido_id)).estado, "pagado");
  assert.equal(await stockDe(prod.id), 0);

  // El cliente cancela un pendiente por su token; uno entregado, no.
  await q("update public.productos set stock = 1 where id = $1", [prod.id]);
  const pR = await pedir(uno1, "Rita", "rita@test.com", "efectivo");
  assert.equal(await stockDe(prod.id), 0);
  await como("anon", () => falla(q("select public.cancelar_pedido_cliente($1)", [pR.token]), /permission denied/, "anon cancela"));
  assert.equal((await servicio("select public.cancelar_pedido_cliente($1) as r", [pR.token]))[0].r, true);
  assert.equal((await servicio("select public.cancelar_pedido_cliente($1) as r", [pR.token]))[0].r, false);
  const porCliente = await pedidoDe(pR.pedido_id);
  assert.deepEqual({ e: porCliente.estado, por: porCliente.cancelado_por }, { e: "cancelado", por: "cliente" });
  assert.equal(await stockDe(prod.id), 1);
  assert.equal((await servicio("select public.cancelar_pedido_cliente($1) as r", [pP.token]))[0].r, false);
  assert.equal((await pedidoDe(pP.pedido_id)).estado, "entregado");

  // Panel con el negocio apagado: solo lectura.
  const pS = await pedir(uno1, "Sara", "sara@test.com", "efectivo");
  await q("update public.negocios set suspendido_at = now() where id = $1", [negA]);
  try {
    await como("ana", () => falla(q("select public.pedido_marcar_pagado($1)", [pS.pedido_id]), /NEGOCIO_NO_HABILITADO/, "apagado"));
    // El cliente sigue pudiendo cancelar.
    assert.equal((await servicio("select public.cancelar_pedido_cliente($1) as r", [pS.token]))[0].r, true);
  } finally {
    await q("update public.negocios set suspendido_at = null where id = $1", [negA]);
  }
});

await prueba("pedidos: tienda apagada o negocio que no toma reservas no recibe pedidos; con turno, efectivo hasta el día del turno", async () => {
  const prod = await como("ana", () => uno("insert into public.productos (negocio_id, nombre, precio, stock) values ($1, 'Aceite', 4000, 10) returning id", [negA]));
  const uno1 = [{ producto_id: prod.id, cantidad: 1 }];

  await q("update public.negocios set tienda_activa = false where id = $1", [negA]);
  await falla(pedir(uno1, "Tomás", "tomas@test.com", "efectivo"), /TIENDA_NO_DISPONIBLE/, "tienda apagada");
  await q("update public.negocios set tienda_activa = true where id = $1", [negA]);

  await q("update public.negocios set suspendido_at = now() where id = $1", [negA]);
  try {
    await falla(pedir(uno1, "Tomás", "tomas@test.com", "efectivo"), /NEGOCIO_NO_DISPONIBLE/, "dado de baja");
  } finally {
    await q("update public.negocios set suspendido_at = null where id = $1", [negA]);
  }

  // Transferencia sin alias ni CBU: no se ofrece.
  await q("update public.negocios set transferencia_alias = null where id = $1", [negA]);
  await falla(pedir(uno1, "Tomás", "tomas@test.com", "transferencia"), /TIENDA_NO_DISPONIBLE/, "sin alias");
  await q("update public.negocios set transferencia_alias = 'peluqueria.ana' where id = $1", [negA]);
  assert.equal(await stockDe(prod.id), 10);

  // Un turno de un lunes (más de 3 días adelante): el efectivo vence al terminar ese día.
  let turno;
  for (const semanas of [1, 2, 3]) {
    const fecha = (await uno("select ($1::date + $2::int * 7)::text as d", [lunes, semanas])).d;
    const libre = (await como("anon", () => q("select * from public.horarios_libres($1, $2, $3::date, $4)", [negA, servA, fecha, profAna])))[0];
    if (libre) {
      turno = await reservar("select * from public.crear_reserva($1, $2, $3, $4, 'Tomás', '1166660000', 'tomas@test.com')", [negA, servA, profAna, libre.inicio]);
      break;
    }
  }
  assert.ok(turno?.token, "hay un horario libre");
  const conTurno = await pedir(uno1, "Tomás", "tomas@test.com", "efectivo", turno.token);
  const p = await pedidoDe(conTurno.pedido_id);
  assert.equal(p.turno_id, turno.turno_id);
  const fin = await uno(
    `select ((t.inicio at time zone 'America/Argentina/Buenos_Aires')::date + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires' as fin
     from public.turnos t where t.id = $1`,
    [turno.turno_id],
  );
  assert.equal(+p.vence_at, +fin.fin);
  assert.ok(+p.vence_at > Date.now() + 3 * DIA);
  const visto = (await servicio("select public.ver_pedido($1) as d", [conTurno.token]))[0].d;
  assert.ok(visto.turno?.inicio, "ver_pedido muestra el turno");

  // Un token de turno de otro negocio se ignora.
  await q("update public.negocios set tienda_activa = true where id = $1", [negB]);
  const deBeto = await uno("insert into public.productos (negocio_id, nombre, precio, stock) values ($1, 'Navaja', 9000, 2) returning id", [negB]);
  try {
    const ajeno = await pedir([{ producto_id: deBeto.id, cantidad: 1 }], "Tomás", "tomas@test.com", "efectivo", turno.token, negB);
    const pa = await pedidoDe(ajeno.pedido_id);
    assert.equal(pa.turno_id, null);
    assert.equal(ajeno.numero, 1, "la numeración es por negocio");
    const d = await uno("select round(extract(epoch from vence_at - created_at) / 86400) as d from public.pedidos where id = $1", [ajeno.pedido_id]);
    assert.equal(Number(d.d), 3);
  } finally {
    await q("delete from public.pedidos where negocio_id = $1", [negB]);
    await q("delete from public.productos where id = $1", [deBeto.id]);
    await q("update public.negocios set tienda_activa = false where id = $1", [negB]);
  }
  // Si el turno se cancela, el pedido en efectivo vuelve al plazo común (3 días desde que se hizo).
  await como("anon", () => q("select public.cancelar_turno_cliente($1)", [turno.token]));
  const sinExtension = await uno("select round(extract(epoch from vence_at - created_at) / 86400) as d, estado from public.pedidos where id = $1", [conTurno.pedido_id]);
  assert.deepEqual({ d: Number(sinExtension.d), e: sinExtension.estado }, { d: 3, e: "pendiente" });
  // Si esos días ya pasaron, el cron lo vence y devuelve el stock.
  const pT = await pedir(uno1, "Tobías", "tobias@test.com", "efectivo");
  await q("update public.pedidos set turno_id = $2, vence_at = $3, created_at = now() - interval '4 days' where id = $1", [pT.pedido_id, turno.turno_id, fin.fin]);
  await q("update public.turnos set estado = 'confirmado' where id = $1", [turno.turno_id]);
  await q("update public.turnos set estado = 'cancelado' where id = $1", [turno.turno_id]);
  const antes = await stockDe(prod.id);
  assert.ok((await servicio("select public.liberar_pedidos_vencidos() as n"))[0].n >= 1);
  assert.equal((await pedidoDe(pT.pedido_id)).estado, "vencido");
  assert.equal(await stockDe(prod.id), antes + 1);
  // Un token de un turno cancelado tampoco se asocia.
  const sinTurno = await pedir(uno1, "Tomás", "tomas@test.com", "efectivo", turno.token);
  assert.equal((await pedidoDe(sinTurno.pedido_id)).turno_id, null);
});

await prueba("cuentas: borrar un usuario borra su perfil, sus sesiones y sus accesos", async () => {
  await q(`insert into auth."session" ("expiresAt", "token", "updatedAt", "userId") values (now() + interval '1 day', 'tok-eva', now(), $1)`, [USUARIOS.eva]);
  await q(`insert into public.accesos (usuario_id, tipo, token_hash, expira_at) values ($1, 'recuperacion', repeat('a', 64), now() + interval '1 day')`, [USUARIOS.eva]);
  await como("auth", () => q('delete from auth."user" where "id" = $1', [USUARIOS.eva]));
  assert.equal((await q("select * from public.perfiles where id = $1", [USUARIOS.eva])).length, 0);
  assert.equal((await q('select * from auth."session" where "userId" = $1', [USUARIOS.eva])).length, 0);
  assert.equal((await q("select * from public.accesos where usuario_id = $1", [USUARIOS.eva])).length, 0);
  // Sus turnos quedan en el negocio.
  assert.ok((await q("select * from public.turnos where profesional_id = $1", [profEva])).length > 0);
});

await prueba("admin: eliminar negocio y/o cuentas, con confirmación y registro", async () => {
  const admin = (sql, params) => como("admin", () => uno(sql, params));
  // Un negocio de prueba con dueño y una empleada.
  const ids = { dueno: "00000000-0000-4000-8000-0000000000d1", empleada: "00000000-0000-4000-8000-0000000000d2" };
  for (const [n, id] of Object.entries(ids)) {
    await q(`insert into auth."user" ("id", "name", "email", "emailVerified") values ($1, $2, $3, true)`, [id, n, `${n}@borrar.com`]);
  }
  await q(`insert into auth."session" ("expiresAt", "token", "updatedAt", "userId") values (now() + interval '1 day', 'tok-borrar', now(), $1)`, [ids.dueno]);
  await db.query("select set_config('app.usuario_id', $1, false)", [ids.dueno]);
  await db.exec("set role agenda2_usuario");
  const neg = (await uno("select public.crear_negocio('Prueba Borrar', 'prueba-borrar', 'otro', 'Dueño', null, null, true) as id")).id;
  await db.exec("reset role");
  await db.query("select set_config('app.usuario_id', '', false)");
  await q("insert into public.perfiles (id, negocio_id, rol, nombre) values ($1, $2, 'empleado', 'Empleada')", [ids.empleada, neg]);
  await admin("select plataforma.admin_registrar_pago($1, 15000, 'efectivo', 1, null)", [neg]);

  // Solo un admin, con el nombre exacto y algo para borrar.
  await como("beto", () => falla(q("select plataforma.admin_eliminar($1, 'Prueba Borrar', true, true)", [neg]), /SIN_PERMISO/, "dueño ajeno"));
  await como("admin", () => falla(q("select plataforma.admin_eliminar($1, 'Otro nombre', true, true)", [neg]), /CONFIRMACION_INCORRECTA/, "nombre"));
  await como("admin", () => falla(q("select plataforma.admin_eliminar($1, 'Prueba Borrar', false, false)", [neg]), /NADA_QUE_BORRAR/, "nada"));

  // Solo las cuentas: el negocio queda sin equipo.
  const r1 = (await admin("select plataforma.admin_eliminar($1, ' prueba borrar ', false, true) as r", [neg])).r;
  assert.deepEqual(r1.cuentas, ["dueno@borrar.com", "empleada@borrar.com"]);
  assert.equal((await q('select * from auth."user" where "id" = any($1)', [Object.values(ids)])).length, 0);
  assert.equal((await q('select * from auth."session" where "userId" = $1', [ids.dueno])).length, 0);
  assert.equal((await q("select * from public.perfiles where negocio_id = $1", [neg])).length, 0);
  assert.ok(await uno("select id from public.negocios where id = $1", [neg]), "el negocio sigue");

  // Ahora el negocio, con todos sus datos.
  const r2 = (await admin("select plataforma.admin_eliminar($1, 'Prueba Borrar', true, false) as r", [neg])).r;
  assert.equal(r2.slug, "prueba-borrar");
  assert.equal(Number(r2.total_pagado), 15000);
  assert.equal(await uno("select id from public.negocios where id = $1", [neg]), undefined);
  for (const t of ["public.profesionales", "public.servicios", "plataforma.pagos"]) {
    assert.equal((await q(`select * from ${t} where negocio_id = $1`, [neg])).length, 0, t);
  }

  // Queda el registro, y la cuenta de un admin nunca se borra.
  const eliminados = await como("admin", () => q("select * from plataforma.admin_eliminados()"));
  assert.equal(eliminados[0].negocio_id, neg);
  assert.equal(eliminados[0].detalle.nombre, "Prueba Borrar");
  const acciones = (await q("select accion from plataforma.auditoria where negocio_id = $1 order by id", [neg])).map((a) => a.accion);
  assert.deepEqual(acciones, ["registrar_pago", "eliminar_cuentas", "eliminar_negocio"]);
  await como("ana", () => falla(q("select * from plataforma.admin_eliminados()"), /SIN_PERMISO/, "dueña lee eliminados"));
  assert.ok(await uno('select "id" from auth."user" where "id" = $1', [USUARIOS.admin]));
});

// --- Socios: dos dueños, cada uno con su agenda y su facturación ------------------------

await prueba("socios: segundo dueño, estadísticas por profesional y avisos a los dos", async () => {
  const sol = "00000000-0000-4000-8000-0000000000c0";
  await q(`insert into auth."user" ("id", "name", "email", "emailVerified") values ($1, 'sol', 'sol@test.com', true)`, [sol]);
  USUARIOS.sol = sol;
  const profSol = await como("ana", async () =>
    (await uno("insert into public.profesionales (negocio_id, nombre) values ($1, 'Sol') returning id", [negA])).id,
  );
  // Como invitarEmpleado con rol de socio: lo inserta el servidor.
  await servicio("insert into public.perfiles (id, negocio_id, rol, nombre, profesional_id) values ($1, $2, 'dueno', 'Sol', $3)", [
    sol, negA, profSol,
  ]);

  const rango = "now() - interval '30 days', now() + interval '60 days'";
  const est = (usuario, prof) =>
    como(usuario, async () => (await uno(`select public.estadisticas_negocio(${rango}, $1::uuid) as e`, [prof])).e);

  // La titular (Ana) ve todo; la socia (Sol), lo suyo y lo de la empleada, no lo de Ana.
  const todos = await est("ana", null);
  const partes = await Promise.all([profAna, profEva, profSol].map((p) => est("ana", p)));
  assert.equal(partes.reduce((s, e) => s + e.total, 0), todos.total);
  assert.equal(partes.reduce((s, e) => s + Number(e.ingresos), 0), Number(todos.ingresos));
  const deEva = partes[1];
  assert.ok(partes[0].total > 0 && deEva.total > 0);
  assert.ok(deEva.por_profesional.every((p) => p.nombre === "Eva"));
  assert.equal(partes[2].total, 0, "Sol todavía no tiene turnos");
  assert.ok(deEva.clientes_nuevos <= todos.clientes_nuevos);
  const deSol = await est("sol", null);
  assert.equal(deSol.total, deEva.total + partes[2].total, "Sol: lo suyo y lo de Eva");
  assert.ok(deSol.por_profesional.every((p) => p.nombre !== "Ana"));
  assert.equal((await est("sol", profAna)).total, 0, "Sol no ve la agenda de Ana");
  assert.deepEqual(await est("sol", profEva), deEva);
  // Sin el tercer parámetro, como antes.
  const sinFiltro = await como("ana", async () => (await uno(`select public.estadisticas_negocio(${rango}) as e`)).e);
  assert.deepEqual(sinFiltro, todos);
  await como("eva", () => falla(q("select public.estadisticas_negocio(now(), now(), $1::uuid)", [profEva]), /SIN_PERMISO/, "empleada"));
  // Beto, de otro negocio, no saca nada aunque pase un profesional de Ana.
  assert.equal((await est("beto", profAna)).total, 0);

  await q("update public.negocios set prueba_hasta = now() + interval '1 day 12 hours', pagado_hasta = null, suspendido_at = null where id = $1", [negA]);
  const avisos = (await servicio("select * from plataforma.reclamar_avisos_suscripcion()")).filter((a) => a.negocio_id === negA);
  assert.deepEqual(avisos.map((a) => [a.tipo, a.dueno_email]), [["por_vencer", "ana@test.com"], ["por_vencer", "sol@test.com"]]);
  await q("update public.negocios set prueba_hasta = now() + interval '7 days' where id = $1", [negA]);
});

await prueba("socios: agendas por jerarquía (titular todo, socia lo suyo y lo de empleados)", async () => {
  const profSol = (await uno("select profesional_id as id from public.perfiles where id = $1", [USUARIOS.sol])).id;
  const TZ = "America/Argentina/Buenos_Aires";
  const enHora = async (h) => (await uno("select (($1::date + 28 + $2::time) at time zone $3) as t", [lunes, h, TZ])).t;
  const ve = (usuario, sql, params) => como(usuario, () => q(sql, params));
  const visibles = async (usuario) =>
    new Set((await ve(usuario, "select distinct profesional_id from public.turnos where negocio_id = $1", [negA])).map((t) => t.profesional_id));

  // Un turno en la agenda de Sol, cargado por ella.
  const deSol = await como("sol", async () =>
    (await uno("select public.crear_turno_panel($1, $2, $3, 'De Sol', '1177770001') as id", [profSol, servA, await enHora("09:00")])).id,
  );
  // Y uno en la de Eva, cargado por Sol (puede: es de una empleada).
  await como("sol", async () => uno("select public.crear_turno_panel($1, $2, $3, 'Para Eva', '1177770002') as id", [profEva, servA, await enHora("10:00")]));

  const deAna = await visibles("ana");
  assert.ok(deAna.has(profAna) && deAna.has(profEva) && deAna.has(profSol), "Ana ve todo");
  const vistosPorSol = await visibles("sol");
  assert.ok(!vistosPorSol.has(profAna) && vistosPorSol.has(profEva) && vistosPorSol.has(profSol), "Sol no ve a Ana");
  assert.deepEqual(
    (await ve("sol", "select public.ve_agenda($1, $2) as a, public.ve_agenda($1, $3) as b, public.es_titular($1) as t", [negA, profAna, profEva]))[0],
    { a: false, b: true, t: false },
  );
  assert.equal((await ve("ana", "select public.es_titular($1) as t", [negA]))[0].t, true);

  // Sol no carga, mueve ni bloquea en la agenda de Ana.
  await como("sol", async () =>
    falla(q("select public.crear_turno_panel($1, $2, $3, 'X Y', '1177770003')", [profAna, servA, await enHora("11:00")]), /SIN_PERMISO/, "turno en agenda de Ana"),
  );
  await como("sol", async () =>
    falla(q("select * from public.crear_turno_fijo($1, $2, $3, 1, 'X Y', '1177770003')", [profAna, servA, await enHora("11:00")]), /SIN_PERMISO/, "fijo en agenda de Ana"),
  );
  await como("sol", () => falla(q("update public.turnos set profesional_id = $1 where id = $2", [profAna, deSol]), /row-level security/, "mover a la agenda de Ana"));
  const { n } = await como("sol", () => uno("with x as (update public.turnos set notas = 'x' where profesional_id = $1 returning 1) select count(*)::int as n from x", [profAna]));
  assert.equal(n, 0, "no toca turnos de Ana");
  await como("sol", async () =>
    falla(
      q("insert into public.bloqueos (negocio_id, profesional_id, inicio, fin) values ($1, $2, $3, $3::timestamptz + interval '1 hour')", [negA, profAna, await enHora("12:00")]),
      /row-level security/,
      "ausencia en agenda de Ana",
    ),
  );
  await como("sol", () =>
    falla(q("select public.guardar_horarios($1, '[{\"dia_semana\": 3, \"desde\": \"09:00\", \"hasta\": \"12:00\"}]'::jsonb)", [profAna]), /row-level security/, "horario de Ana"),
  );
  assert.ok((await uno("select count(*)::int as n from public.horarios_profesional where profesional_id = $1", [profAna])).n > 0, "el horario de Ana sigue");

  // Ana sí ve y puede tocar lo de Sol.
  const { n: n2 } = await como("ana", () => uno("with x as (update public.turnos set notas = 'ok' where id = $1 returning 1) select count(*)::int as n from x", [deSol]));
  assert.equal(n2, 1);

  // El límite de inasistencias es de todo el local, también para Sol.
  const cli = (await uno("select cliente_id from public.turnos where id = $1", [deSol])).cliente_id;
  assert.equal(typeof (await como("sol", () => uno("select public.inasistencias_que_limitan($1) as n", [cli]))).n, "number");

  await q("delete from public.turnos where negocio_id = $1 and nombre_reserva in ('De Sol', 'Para Eva')", [negA]);
});

await prueba("apariencia: color de la página y portada (solo el servidor toca la imagen)", async () => {
  await como("ana", () => q("update public.negocios set color = '#1e3a8a' where id = $1", [negA]));
  assert.equal((await uno("select color from public.negocios where id = $1", [negA])).color, "#1e3a8a");
  await como("ana", () => falla(q("update public.negocios set color = 'rojo' where id = $1", [negA]), /check constraint/, "color inválido"));
  await como("ana", () => falla(q("update public.negocios set color = '#1E3A8A' where id = $1", [negA]), /check constraint/, "mayúsculas"));
  await como("eva", async () => {
    const r = await db.query("update public.negocios set color = '#000000' where id = $1", [negA]).catch((e) => e);
    assert.ok(r instanceof Error || r.affectedRows === 0, "la empleada no cambia el color");
  });
  await como("beto", async () => {
    const r = await db.query("update public.negocios set color = '#000000' where id = $1", [negA]);
    assert.equal(r.affectedRows, 0, "otro negocio");
  });
  await como("ana", () => q("update public.negocios set color = null where id = $1", [negA]));

  const png = Buffer.from("89504e470d0a1a0a0000", "hex");
  await servicio("insert into public.negocio_portadas (negocio_id, tipo, datos) values ($1, 'image/png', $2)", [negA, png]);
  for (const u of ["ana", "anon"]) {
    await como(u, () => falla(q("select * from public.negocio_portadas"), /permission denied/, `${u} lee portadas`));
  }
  await como("ana", () =>
    falla(q("delete from public.negocio_portadas where negocio_id = $1", [negA]), /permission denied/, "dueña borra directo"),
  );
  await servicio("delete from public.negocio_portadas where negocio_id = $1", [negA]);
});

// --- Reseñas: solo quien tuvo el turno, el dueño responde ------------------------------
// Un profesional propio para que sus turnos no choquen con los de otras pruebas.
const profRes = (await uno("insert into public.profesionales (negocio_id, nombre) values ($1, 'Rese') returning id", [negA])).id;

await prueba("reseñas: solo de turnos terminados, una por turno, el dueño responde y oculta el texto", async () => {
  const turno = async (inicio, estado, nombre = "Martina Gómez") =>
    uno(
      `insert into public.turnos (negocio_id, profesional_id, servicio_id, cliente_id, inicio, fin, estado, nombre_reserva, email_reserva)
       values ($1, $2, $3, null, now() + $4::interval, now() + $4::interval + interval '30 minutes', $5, $6, 'martina@mail.com')
       returning id, token_cancelacion as token`,
      [negA, profRes, servA, inicio, estado, nombre],
    );
  const opinar = (token, estrellas, comentario) =>
    como("servidor", () => uno("select public.dejar_resena($1, $2, $3) as r", [token, estrellas, comentario]));

  const hecho = await turno("-5 hours", "confirmado");
  await como("anon", () => falla(q("select public.dejar_resena($1, 5, null)", [hecho.token]), /permission denied/, "anon"));
  await como("ana", () => falla(q("select public.dejar_resena($1, 5, null)", [hecho.token]), /permission denied/, "dueña"));

  const r1 = (await opinar(hecho.token, 4, "  Muy buena atención  ")).r;
  assert.equal(r1.nueva, true);
  const r2 = (await opinar(hecho.token, 5, "Excelente")).r;
  assert.equal(r2.nueva, false);
  assert.equal(r2.id, r1.id);
  const fila = await uno("select * from public.resenas where turno_id = $1", [hecho.id]);
  assert.equal(fila.estrellas, 5);
  assert.equal(fila.comentario, "Excelente");
  assert.equal(fila.autor, "Martina G.");
  assert.equal(fila.profesional_id, profRes);
  await opinar(hecho.token, 5, "   ");
  assert.equal((await uno("select comentario from public.resenas where id = $1", [r1.id])).comentario, null, "vacío = sin comentario");

  for (const [inicio, estado, que] of [
    ["2 hours", "confirmado", "turno por venir"],
    ["-20 minutes", "confirmado", "turno que no terminó"],
    ["-7 hours", "cancelado", "cancelado"],
    ["-9 hours", "ausente", "ausente"],
    ["-61 days", "completado", "hace más de 60 días"],
  ]) {
    const t = await turno(inicio, estado);
    await falla(opinar(t.token, 5, null), /RESENA_NO_DISPONIBLE/, que);
  }
  await falla(opinar(hecho.token, 6, null), /check|RESENA/, "6 estrellas");
  await falla(opinar("f".repeat(64), 5, null), /RESENA_NO_DISPONIBLE/, "token inexistente");

  // El dueño la ve, responde y oculta el comentario; no toca las estrellas.
  await como("ana", () =>
    q("update public.resenas set respuesta = 'Gracias!', respondida_at = now(), comentario_oculto = true where id = $1", [r1.id]),
  );
  const respondida = await uno("select * from public.resenas where id = $1", [r1.id]);
  assert.equal(respondida.respuesta, "Gracias!");
  assert.equal(respondida.comentario_oculto, true);
  await como("ana", () => falla(q("update public.resenas set estrellas = 1 where id = $1", [r1.id]), /permission denied/, "estrellas"));
  await como("ana", () => falla(q("insert into public.resenas (negocio_id, turno_id, profesional_id, servicio_id, autor, estrellas) values ($1, $2, $3, $4, 'X', 5)", [negA, hecho.id, profRes, servA]), /permission denied/, "insertar"));
  assert.equal((await como("eva", () => q("select id from public.resenas"))).length, 0, "la empleada no ve reseñas");
  assert.equal((await como("beto", () => q("select id from public.resenas"))).length, 0, "otro negocio");
  await como("anon", () => falla(q("select id from public.resenas"), /permission denied/, "anon lee"));
  // Volver a opinar no borra la respuesta.
  await opinar(hecho.token, 4, "Bien");
  assert.equal((await uno("select respuesta from public.resenas where id = $1", [r1.id])).respuesta, "Gracias!");

  // Con las reseñas apagadas no se aceptan nuevas.
  await como("ana", () => q("update public.negocios set resenas_activas = false where id = $1", [negA]));
  const otro = await turno("-3 hours", "completado", "Pedro");
  await falla(opinar(otro.token, 5, null), /RESENA_DESACTIVADA/, "apagadas");
  await como("ana", () => q("update public.negocios set resenas_activas = true where id = $1", [negA]));
  assert.equal((await opinar(otro.token, 3, null)).r.nueva, true);
  assert.equal((await uno("select autor from public.resenas where turno_id = $1", [otro.id])).autor, "Pedro");
  await q("delete from public.turnos where id in ($1, $2)", [hecho.id, otro.id]);
  assert.equal((await uno("select count(*)::int as n from public.resenas where negocio_id = $1", [negA])).n, 0, "se borran con el turno");
});

await prueba("reseñas abiertas: cualquiera opina sin turno y el dueño las borra", async () => {
  const libre = (nombre, estrellas, comentario = null, profesional = null, negocio = negA) =>
    como("servidor", () =>
      uno("select public.dejar_resena_libre($1, $2, $3, $4, $5) as id", [negocio, nombre, estrellas, comentario, profesional]),
    );
  await como("anon", () => falla(q("select public.dejar_resena_libre($1, 'X Y', 5, null, null)", [negA]), /permission denied/, "anon"));
  await como("ana", () => falla(q("select public.dejar_resena_libre($1, 'X Y', 5, null, null)", [negA]), /permission denied/, "dueña"));

  const { id } = await libre("  lucía   pérez ", 5, "  Re lindo el lugar ", profRes);
  const fila = await uno("select * from public.resenas where id = $1", [id]);
  assert.equal(fila.turno_id, null);
  assert.equal(fila.servicio_id, null);
  assert.equal(fila.profesional_id, profRes);
  assert.equal(fila.autor, "lucía P.");
  assert.equal(fila.comentario, "Re lindo el lugar");
  // Un profesional de otro negocio se ignora; dos opiniones de la misma persona se aceptan.
  const ajeno = await uno("select id from public.profesionales where negocio_id <> $1 limit 1", [negA]);
  const otra = await libre("Lucía Pérez", 2, null, ajeno?.id ?? null);
  assert.equal((await uno("select profesional_id from public.resenas where id = $1", [otra.id])).profesional_id, null);

  await falla(libre("L", 5), /RESENA_NOMBRE/, "nombre corto");
  await falla(libre("Lucía", 0), /check/, "0 estrellas");
  await falla(libre("Lucía", 5, "x".repeat(601)), /check/, "comentario largo");
  await falla(libre("Lucía", 5, null, null, "00000000-0000-0000-0000-000000000000"), /RESENA_NO_DISPONIBLE/, "negocio inexistente");
  await falla(q("insert into public.resenas (negocio_id, turno_id, autor, estrellas) values ($1, (select id from public.turnos where negocio_id = $1 limit 1), 'X', 5)", [negA]), /resenas_turno_completo|null/, "turno sin profesional");
  await como("ana", () => q("update public.negocios set resenas_activas = false where id = $1", [negA]));
  await falla(libre("Lucía", 5), /RESENA_DESACTIVADA/, "apagadas");
  await como("ana", () => q("update public.negocios set resenas_activas = true where id = $1", [negA]));

  // Borrar: solo el dueño de ese negocio; la empleada y otro negocio no.
  await como("eva", () => q("delete from public.resenas where id = $1", [id]));
  await como("beto", () => q("delete from public.resenas where id = $1", [id]));
  assert.ok(await uno("select id from public.resenas where id = $1", [id]), "sigue después de empleada y otro negocio");
  const borradas = await como("ana", () => q("delete from public.resenas where id = any($1) returning id", [[id, otra.id]]));
  assert.equal(borradas.length, 2);
  assert.equal((await uno("select count(*)::int as n from public.resenas where negocio_id = $1", [negA])).n, 0);
});

await prueba("reseñas: el cron pide la opinión una sola vez, 2 a 48 h después del turno", async () => {
  await como("anon", () => falla(q("select * from public.reclamar_pedidos_resena(100)"), /permission denied/, "anon"));
  await como("ana", () => falla(q("select * from public.reclamar_pedidos_resena(100)"), /permission denied/, "dueña"));
  const turno = (fin, estado = "confirmado", email = "pide@mail.com") =>
    uno(
      `insert into public.turnos (negocio_id, profesional_id, servicio_id, cliente_id, inicio, fin, estado, nombre_reserva, email_reserva)
       values ($1, $2, $3, null, now() + $4::interval - interval '30 minutes', now() + $4::interval, $5, 'Pide', $6) returning id, token_cancelacion as token`,
      [negA, profRes, servA, fin, estado, email],
    );
  const listo = await turno("-3 hours");
  const reciente = await turno("-1 hour");
  const viejo = await turno("-3 days");
  const cancelado = await turno("-3 hours", "cancelado");
  const sinMail = await turno("-5 hours", "confirmado", null);
  const opinado = await turno("-4 hours");
  await como("servidor", () => q("select public.dejar_resena($1, 5, null)", [opinado.token]));

  const ids = (filas) => filas.map((f) => f.turno_id);
  const primera = await servicio("select * from public.reclamar_pedidos_resena(100)");
  assert.ok(ids(primera).includes(listo.id));
  for (const t of [reciente, viejo, cancelado, sinMail, opinado]) assert.ok(!ids(primera).includes(t.id));
  const f = primera.find((r) => r.turno_id === listo.id);
  assert.equal(f.email, "pide@mail.com");
  assert.equal(f.token, listo.token);
  assert.equal(f.negocio, "Salón Ana");
  assert.ok(!ids(await servicio("select * from public.reclamar_pedidos_resena(100)")).includes(listo.id), "una sola vez");

  await como("ana", () => q("update public.negocios set resenas_activas = false where id = $1", [negA]));
  const apagado = await turno("-6 hours");
  assert.ok(!ids(await servicio("select * from public.reclamar_pedidos_resena(100)")).includes(apagado.id));
  await como("ana", () => q("update public.negocios set resenas_activas = true where id = $1", [negA]));
  await q("delete from public.turnos where id = any($1)", [[listo, reciente, viejo, cancelado, sinMail, opinado, apagado].map((t) => t.id)]);
});

// --- Productos, tienda y seña apagada (0020) -----------------------------------------

await prueba("seña apagada: con Mercado Pago conectado y seña configurada, la reserva no pide seña", async () => {
  await q("update public.negocios set sena_tipo = 'porcentaje', sena_valor = 50 where id = $1", [negA]);
  await q("insert into public.integraciones (negocio_id, proveedor, estado, config) values ($1, 'mercadopago', 'activa', '{}') on conflict do nothing", [negA]);
  try {
    const r = await reservarAna(2, "12:00", "Sena Cero", "1155559999", "senacero@test.com");
    const t = await uno("select estado from public.turnos where id = $1", [r.turno_id]);
    assert.equal(t.estado, "confirmado", "sin seña el turno no queda retenido");
    assert.equal(Number(r.sena ?? 0), 0);
  } finally {
    await q("update public.negocios set sena_tipo = 'ninguna', sena_valor = 0 where id = $1", [negA]);
    await q("delete from public.integraciones where negocio_id = $1 and proveedor = 'mercadopago'", [negA]);
  }
});

await db.close();

// --- Migraciones ----------------------------------------------------------------------
await prueba("migraciones: una segunda corrida no hace nada; editar una aplicada se rechaza", async () => {
  const carpeta = mkdtempSync(join(tmpdir(), "agenda2-migraciones-"));
  try {
    cpSync(CARPETA_MIGRACIONES, carpeta, { recursive: true });
    const { db: m, ejecutar } = await baseNueva({ carpeta });
    await m.exec("set role agenda2_dueno");
    assert.deepEqual(await migrar(ejecutar, { carpeta, log: () => {} }), []);

    writeFileSync(join(carpeta, "9001_nueva.sql"), "create table public.prueba_nueva (id int);");
    assert.deepEqual(await migrar(ejecutar, { carpeta, log: () => {} }), ["9001_nueva.sql"]);
    const versiones = (await m.query("select version from app.schema_version order by 1")).rows.map((r) => r.version);
    assert.deepEqual(versiones.slice(-1), [9001]);

    writeFileSync(join(carpeta, "9001_nueva.sql"), "create table public.prueba_nueva (id bigint);");
    await falla(migrar(ejecutar, { carpeta, log: () => {} }), /cambió después de aplicarse/, "migración editada");

    writeFileSync(join(carpeta, "9001_nueva.sql"), "create table public.prueba_nueva (id int);");
    writeFileSync(join(carpeta, "9002_rota.sql"), "create table public.rota (id int); select 1/0;");
    await falla(migrar(ejecutar, { carpeta, log: () => {} }), /9002_rota/, "migración con error");
    assert.equal((await m.query("select to_regclass('public.rota') as t")).rows[0].t, null, "la migración fallida no deja nada");
    await m.close();
  } finally {
    rmSync(carpeta, { recursive: true, force: true });
  }
});

// --- seed en una base nueva ------------------------------------------------------------
await prueba("seed: carga los datos demo, los usuarios entran y el negocio queda reservable", async () => {
  const { db: s, ejecutar } = await baseNueva();
  await cargarSeed(ejecutar);
  const neg = (await s.query("select public.negocio_publico('estudio-luna') as d")).rows[0].d;
  assert.equal(neg.servicios.length, 4);
  assert.equal(neg.profesionales.length, 2);
  assert.equal(neg.reservas_habilitadas, true, "los demo quedan pagos");
  const pelu = (await s.query("select public.negocio_publico('peluqueria-caballeros') as d")).rows[0].d;
  assert.equal(pelu.rubro, "peluqueria_masculina");
  assert.equal(pelu.servicios.length, 4);
  assert.equal(pelu.emergencias.length, 1, "corte de emergencia aparte");
  for (const u of USUARIOS_DEMO) {
    const { rows } = await s.query(
      `select a."password", p.rol from auth."user" u
       join auth."account" a on a."userId" = u."id" and a."providerId" = 'credential'
       join public.perfiles p on p.id = u."id"
       where u."email" = $1 and u."emailVerified"`,
      [u.email],
    );
    assert.equal(rows.length, 1, u.email);
    assert.equal(rows[0].rol, "dueno");
    assert.equal(await verifyPassword({ hash: rows[0].password, password: CLAVE_DEMO }), true);
  }
  await s.close();
});

console.log(`\n${pruebas} pruebas OK`);
