// Prueba las migraciones SQL contra un Postgres embebido (PGlite), sin Docker.
// Emula lo mínimo de Supabase: esquema auth, auth.uid(), roles anon/authenticated
// y los privilegios por defecto que Supabase otorga sobre el esquema public.
//
// Uso: npm run test:db
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const MIGRACIONES = join(import.meta.dirname, "..", "supabase", "migrations");

const db = new PGlite({ extensions: { btree_gist } });

await db.exec(`
  create schema auth;
  create schema extensions;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public, auth, extensions to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`);

for (const archivo of readdirSync(MIGRACIONES).filter((f) => f.endsWith(".sql")).sort()) {
  try {
    await db.exec(readFileSync(join(MIGRACIONES, archivo), "utf8"));
  } catch (e) {
    console.error(`✗ Falló la migración ${archivo}: ${e.message}`);
    process.exit(1);
  }
  console.log(`✓ migración ${archivo}`);
}

// --- helpers --------------------------------------------------------------------
const USUARIOS = {
  ana: "00000000-0000-4000-8000-00000000000a", // dueña negocio A
  beto: "00000000-0000-4000-8000-00000000000b", // dueño negocio B
  eva: "00000000-0000-4000-8000-00000000000e", // empleada negocio A
  nadie: "00000000-0000-4000-8000-0000000000ff", // registrado sin negocio
};
for (const [nombre, id] of Object.entries(USUARIOS)) {
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${nombre}@test.com`]);
}

async function como(usuario, fn) {
  await db.exec("reset role");
  if (usuario === "anon") {
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
    await db.exec("set role anon");
  } else if (usuario) {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [USUARIOS[usuario]]);
    await db.exec("set role authenticated");
  }
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}
const q = async (sql, params) => (await db.query(sql, params)).rows;
const uno = async (sql, params) => (await q(sql, params))[0];

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

let negA, negB, servA, profAna, profEva;

await prueba("onboarding: crear_negocio crea negocio + perfil de dueña + profesional", async () => {
  negA = await como("ana", async () =>
    (await uno("select public.crear_negocio('Salón Ana', 'salon-ana', 'peluqueria', 'Ana', null, null, true) as id")).id,
  );
  const perfil = await uno("select * from public.perfiles where id = $1", [USUARIOS.ana]);
  assert.equal(perfil.rol, "dueno");
  assert.equal(perfil.negocio_id, negA);
  assert.ok(perfil.profesional_id);
  profAna = perfil.profesional_id;
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
    (await uno("select public.crear_negocio('Barbería Beto', 'barberia-beto', 'barberia', 'Beto') as id")).id,
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
    for (const t of ["negocios", "perfiles", "servicios", "profesionales", "turnos", "clientes"]) {
      assert.equal((await q(`select * from public.${t}`)).length, 0, t);
    }
  });
});

await prueba("anon: sin acceso directo a tablas", async () => {
  await como("anon", async () => {
    for (const t of ["negocios", "servicios", "turnos", "clientes", "perfiles"]) {
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

let token1, inicio10;
await prueba("reserva: crear_reserva sin cuenta devuelve token", async () => {
  inicio10 = (await uno("select (($1::date + time '10:00') at time zone 'America/Argentina/Buenos_Aires') as t", [lunes])).t;
  const r = await como("anon", () =>
    uno("select * from public.crear_reserva($1, $2, $3, $4, 'Lucía', '+54 9 11 5555-1234', 'lucia@mail.com')", [
      negA,
      servA,
      profAna,
      inicio10,
    ]),
  );
  assert.match(r.token, /^[0-9a-f]{64}$/);
  token1 = r.token;
  const turno = await uno("select * from public.turnos where id = $1", [r.turno_id]);
  assert.equal(turno.estado, "confirmado");
  assert.equal(Number(turno.precio), 8000);
  const cli = await uno("select * from public.clientes where id = $1", [turno.cliente_id]);
  assert.equal(cli.telefono, "5491155551234");
});

await prueba("reserva: mismo horario y profesional se rechaza; con 'cualquiera' se asigna a otra", async () => {
  await como("anon", () =>
    falla(
      q("select * from public.crear_reserva($1, $2, $3, $4, 'Otro', '1144445555', null)", [negA, servA, profAna, inicio10]),
      /HORARIO_NO_DISPONIBLE/,
      "duplicado",
    ),
  );
  const r = await como("anon", () =>
    uno("select * from public.crear_reserva($1, $2, null, $3, 'Otro', '1144445555', null)", [negA, servA, inicio10]),
  );
  const t = await uno("select profesional_id from public.turnos where id = $1", [r.turno_id]);
  assert.equal(t.profesional_id, profEva);
  await como("anon", () =>
    falla(
      q("select * from public.crear_reserva($1, $2, null, $3, 'Tercero', '1144446666', null)", [negA, servA, inicio10]),
      /HORARIO_NO_DISPONIBLE/,
      "sin profesionales libres",
    ),
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
  await como("anon", () =>
    falla(
      q("select * from public.crear_reserva($1, $2, null, $3, 'Juan', '1144447777', null)", [negA, servA, fuera]),
      /HORARIO_NO_DISPONIBLE/,
      "fuera de agenda",
    ),
  );
  await como("anon", () =>
    falla(
      q("select * from public.crear_reserva($1, $2, null, $3, 'J', '12', 'no-es-mail')", [negA, servA, inicio10]),
      /DATOS_INVALIDOS/,
      "datos inválidos",
    ),
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

await prueba("token: no se puede cancelar fuera del plazo de la política", async () => {
  const t = await uno(
    `insert into public.turnos (negocio_id, profesional_id, servicio_id, cliente_id, inicio, fin)
     select negocio_id, $1, servicio_id, cliente_id, now() + interval '1 hour', now() + interval '2 hours'
     from public.turnos limit 1
     returning token_cancelacion`,
    [profAna],
  );
  await como("anon", () =>
    falla(q("select public.cancelar_turno_cliente($1)", [t.token_cancelacion]), /FUERA_DE_PLAZO/, "fuera de plazo"),
  );
});

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
    const clientes = await q("select * from public.clientes");
    assert.equal(clientes.length, 1); // solo "Otro", que tiene turno con ella
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
    const neg = await uno("select nombre from public.negocios");
    assert.equal(neg.nombre, "Salón Ana");
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

await prueba("anti-abuso: máximo 3 turnos futuros por teléfono", async () => {
  const horas = ["09:00", "11:00", "14:00", "16:00"];
  const res = [];
  for (const h of horas) {
    const ini = (await uno("select (($1::date + $2::time) at time zone 'America/Argentina/Buenos_Aires') as t", [lunes, h])).t;
    res.push(
      await como("anon", () =>
        q("select * from public.crear_reserva($1, $2, $3, $4, 'Spam', '1199990000', null)", [negA, servA, profAna, ini]).then(
          () => "ok",
          (e) => e.message,
        ),
      ),
    );
  }
  assert.deepEqual(res.slice(0, 3), ["ok", "ok", "ok"]);
  assert.match(res[3], /LIMITE_TURNOS/);
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
  const slots = await como("anon", () =>
    q("select * from public.horarios_libres($1, $2, $3::date, $4)", [negA, servA, lunes, profEva]),
  );
  // Solo la tarde (13) menos el turno de 15:00 (15:00-16:00 => pierde 14:15..15:45 = 7)
  assert.equal(slots.length, 13 - 7);
  const dias = await como("anon", () => q("select * from public.dias_disponibles($1, $2, $3::date, 14)", [negA, servA, lunes]));
  assert.equal(dias.length, 2); // dos lunes en 14 días
});

await prueba("recordatorios: solo service_role, marca una sola vez", async () => {
  await como("anon", () => falla(q("select * from public.reclamar_recordatorios()"), /permission denied/, "anon"));
  await como("ana", () => falla(q("select * from public.reclamar_recordatorios()"), /permission denied/, "dueña"));

  // Turno de mañana (dentro de 24 h), con email y reservado hace rato.
  const t = await uno(
    `insert into public.turnos (negocio_id, profesional_id, servicio_id, cliente_id, inicio, fin, created_at)
     select t.negocio_id, $1, t.servicio_id, t.cliente_id, now() + interval '20 hours', now() + interval '21 hours', now() - interval '2 days'
     from public.turnos t join public.clientes c on c.id = t.cliente_id
     where c.email is not null limit 1
     returning id`,
    [profEva],
  );
  await db.exec("set role service_role");
  try {
    const primera = await q("select * from public.reclamar_recordatorios()");
    assert.ok(primera.some((r) => r.turno_id === t.id));
    const fila = primera.find((r) => r.turno_id === t.id);
    assert.equal(fila.email, "lucia@mail.com");
    assert.equal(fila.negocio, "Salón Ana");
    const segunda = await q("select * from public.reclamar_recordatorios()");
    assert.ok(!segunda.some((r) => r.turno_id === t.id));
  } finally {
    await db.exec("reset role");
  }
});

// --- Fases 5 y 6: seña, integraciones, Google, límites, estadísticas, WhatsApp ---
async function comoServicio(fn) {
  await db.exec("set role service_role");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}
const servicio = (sql, params) => comoServicio(() => q(sql, params));
const libresAna = () =>
  como("anon", () => q("select * from public.horarios_libres($1, $2, $3::date, $4)", [negA, servA, lunes, profAna]));

await prueba("seña: sin Mercado Pago conectado no se pide seña", async () => {
  await q("update public.negocios set sena_tipo = 'porcentaje', sena_valor = 50 where id = $1", [negA]);
  const data = await como("anon", async () => (await uno("select public.negocio_publico('salon-ana') as d")).d);
  assert.equal(data.servicios[0].sena, null);
});

let mpA;
await prueba("seña: con Mercado Pago, la reserva queda retenida y se confirma al pagar", async () => {
  mpA = (
    await uno("insert into public.integraciones (negocio_id, proveedor, estado) values ($1, 'mercadopago', 'activa') returning id", [negA])
  ).id;
  const data = await como("anon", async () => (await uno("select public.negocio_publico('salon-ana') as d")).d);
  assert.equal(Number(data.servicios[0].sena), 4000);

  const slot = (await libresAna()).at(-1);
  const r = await como("anon", () =>
    uno("select * from public.crear_reserva($1, $2, $3, $4, 'Pagadora', '1150001111', null)", [negA, servA, profAna, slot.inicio]),
  );
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
  const r = await como("anon", () =>
    uno("select * from public.crear_reserva($1, $2, $3, $4, 'Tardía', '1150002222', null)", [negA, servA, profAna, slot.inicio]),
  );
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
  const r = await como("anon", () =>
    uno("select * from public.crear_reserva($1, $2, $3, $4, 'Lenta', '1150003333', null)", [negA, servA, profAna, slot.inicio]),
  );
  await q("update public.turnos set pago_vence_at = now() - interval '1 minute' where id = $1", [r.turno_id]);
  // Otra persona reserva el mismo horario (crear_reserva libera la retención vencida).
  const otra = await como("anon", () =>
    uno("select * from public.crear_reserva($1, $2, $3, $4, 'Rápida', '1150004444', null)", [negA, servA, profAna, slot.inicio]),
  );
  assert.ok(otra.turno_id);
  assert.equal((await servicio("select public.registrar_pago($1, 'p3', true, 4000) as r", [r.turno_id]))[0].r, "reembolsar");
  assert.equal((await servicio("select public.registrar_pago($1, 'p4', true, 100) as r", [otra.turno_id]))[0].r, "reembolsar");
  assert.equal((await servicio("select public.registrar_pago($1, 'p5', false, 4000) as r", [otra.turno_id]))[0].r, "ya_procesado");
  await q("update public.negocios set sena_tipo = 'ninguna' where id = $1", [negA]);
});

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
});

await prueba("whatsapp: recordatorios con marca propia", async () => {
  await q("update public.negocios set whatsapp_avisos = true where id = $1", [negA]);
  const primera = await servicio("select * from public.reclamar_recordatorios_whatsapp()");
  assert.ok(primera.length >= 1);
  assert.match(primera[0].telefono, /^\d+$/);
  assert.equal((await servicio("select * from public.reclamar_recordatorios_whatsapp()")).length, 0);
});

await db.close();

// --- seed.sql en una base nueva (con las columnas de auth que usa) ----------------
await prueba("seed: carga datos demo y el negocio queda reservable", async () => {
  const s = new PGlite({ extensions: { btree_gist, pgcrypto } });
  await s.exec(`
    create schema auth;
    create schema extensions;
    create extension pgcrypto with schema extensions;
    create table auth.users (
      instance_id uuid, id uuid primary key, aud text, role text, email text, encrypted_password text,
      email_confirmed_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb,
      created_at timestamptz, updated_at timestamptz, confirmation_token text, recovery_token text,
      email_change_token_new text, email_change text
    );
    create table auth.identities (
      id uuid primary key, user_id uuid references auth.users, provider_id text, identity_data jsonb,
      provider text, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz
    );
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  `);
  for (const archivo of readdirSync(MIGRACIONES).filter((f) => f.endsWith(".sql")).sort()) {
    await s.exec(readFileSync(join(MIGRACIONES, archivo), "utf8"));
  }
  await s.exec(readFileSync(join(MIGRACIONES, "..", "seed.sql"), "utf8"));
  const neg = (await s.query("select public.negocio_publico('estudio-luna') as d")).rows[0].d;
  assert.equal(neg.servicios.length, 4);
  assert.equal(neg.profesionales.length, 2);
  const { ok } = (await s.query("select extensions.crypt('demo1234', encrypted_password) = encrypted_password as ok from auth.users")).rows[0];
  assert.equal(ok, true);
  await s.close();
});

console.log(`\n${pruebas} pruebas OK`);
