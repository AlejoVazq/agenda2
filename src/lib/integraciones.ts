import "server-only";
import { cifrar, descifrar } from "@/lib/cifrado";
import { comoServidor, sql } from "@/lib/db";

// Acceso a integraciones y sus secretos. Todo pasa por el rol del servidor:
// llamar solo después de verificar que el usuario actual tiene permiso sobre el
// negocio o profesional en cuestión (o desde procesos del servidor como el cron).

export type Proveedor = "google_calendar" | "mercadopago" | "whatsapp";
export type EstadoIntegracion = "inactiva" | "activa" | "error";

export type Integracion<C = Record<string, unknown>> = {
  id: string;
  negocio_id: string;
  profesional_id: string | null;
  proveedor: Proveedor;
  estado: EstadoIntegracion;
  config: C;
  updated_at: string;
};

const COLUMNAS = sql`id, negocio_id, profesional_id, proveedor, estado, config, updated_at`;

export async function buscarIntegracion<C>(
  negocioId: string,
  proveedor: Proveedor,
  profesionalId: string | null = null,
): Promise<Integracion<C> | null> {
  return comoServidor((tx) =>
    tx.uno<Integracion<C>>(sql`
      select ${COLUMNAS} from public.integraciones
      where negocio_id = ${negocioId} and proveedor = ${proveedor}
        and profesional_id is not distinct from ${profesionalId}::uuid`),
  );
}

/** Integraciones activas de un proveedor en todos los negocios (para el cron). */
export async function integracionesActivas<C>(proveedor: Proveedor): Promise<Integracion<C>[]> {
  return comoServidor((tx) =>
    tx.varios<Integracion<C>>(sql`
      select ${COLUMNAS} from public.integraciones where proveedor = ${proveedor} and estado = 'activa'`),
  );
}

export async function leerSecreto<S>(integracionId: string): Promise<S | null> {
  const fila = await comoServidor((tx) =>
    tx.uno<{ datos: string }>(sql`select datos from public.integraciones_secretos where integracion_id = ${integracionId}`),
  );
  if (!fila) return null;
  try {
    return descifrar<S>(fila.datos);
  } catch (e) {
    console.error("[integraciones] no se pudo descifrar el secreto", integracionId, e);
    return null;
  }
}

/** Crea o reemplaza la integración (y su secreto) y la deja activa. */
export async function guardarIntegracion<C, S>(datos: {
  negocioId: string;
  proveedor: Proveedor;
  profesionalId?: string | null;
  config: C;
  secreto: S;
}) {
  const secreto = cifrar(datos.secreto);
  return comoServidor(async (tx) => {
    const fila = await tx.uno<{ id: string }>(sql`
      insert into public.integraciones (negocio_id, profesional_id, proveedor, estado, config)
      values (${datos.negocioId}, ${datos.profesionalId ?? null}, ${datos.proveedor}, 'activa', ${JSON.stringify(datos.config)}::jsonb)
      on conflict (negocio_id, proveedor, profesional_id)
        do update set estado = 'activa', config = excluded.config
      returning id`);
    const id = fila!.id;
    await tx.ejecutar(sql`
      insert into public.integraciones_secretos (integracion_id, datos) values (${id}, ${secreto})
      on conflict (integracion_id) do update set datos = excluded.datos`);
    return id;
  });
}

export async function actualizarSecreto<S>(integracionId: string, secreto: S) {
  const datos = cifrar(secreto);
  await comoServidor((tx) =>
    tx.ejecutar(sql`update public.integraciones_secretos set datos = ${datos} where integracion_id = ${integracionId}`),
  );
}

/** Cambia estado y/o mezcla datos en config (p. ej. último error o sincronización). */
export async function actualizarIntegracion(
  integracion: Pick<Integracion, "id" | "config">,
  cambios: { estado?: EstadoIntegracion; config?: Record<string, unknown> },
) {
  if (!cambios.estado && !cambios.config) return;
  await comoServidor((tx) =>
    tx.ejecutar(sql`
      update public.integraciones set
        estado = coalesce(${cambios.estado ?? null}, estado),
        config = case when ${cambios.config ? JSON.stringify(cambios.config) : null}::jsonb is null then config
                      else config || ${cambios.config ? JSON.stringify(cambios.config) : null}::jsonb end
      where id = ${integracion.id}`),
  );
}

export async function borrarIntegracion(integracionId: string) {
  // El secreto se borra en cascada.
  await comoServidor((tx) => tx.ejecutar(sql`delete from public.integraciones where id = ${integracionId}`));
}
