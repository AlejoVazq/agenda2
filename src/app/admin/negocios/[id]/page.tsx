import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { EncabezadoPagina, Insignia, Tarjeta, cx } from "@/components/ui";
import { requerirAdmin } from "@/lib/admin";
import { comoUsuario, esErrorPg, sql } from "@/lib/db";
import { formatDuracion, formatFechaCorta, formatFechaHora, formatPrecio } from "@/lib/fechas";
import { DIAS_SEMANA, RUBROS, type Rubro } from "@/lib/tipos";
import { linkWhatsApp } from "@/lib/whatsapp";
import { InsigniaEstado } from "../../estado";
import { LineaMembresia } from "../../membresia";
import { convieneAvisar, textoAvisoWhatsApp } from "../../aviso-whatsapp";
import { ACCIONES_AUDITORIA, MEDIOS_PAGO, type NegocioAdmin } from "../../tipos";
import {
  AnularPago,
  BotonAvisoWhatsApp,
  BotonLinkAcceso,
  BotonReenviarVerificacion,
  FormularioEliminar,
  FormularioExtender,
  FormularioNota,
  FormularioPago,
  FormularioSlug,
  FormularioSuspension,
} from "./formularios";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Seccion({ titulo, children, className }: { titulo: string; children: ReactNode; className?: string }) {
  return (
    <Tarjeta className={cx("space-y-3", className)}>
      <h2 className="text-base font-bold">{titulo}</h2>
      {children}
    </Tarjeta>
  );
}

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{etiqueta}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}

function textoDetalle(accion: string, d: Record<string, unknown>) {
  switch (accion) {
    case "registrar_pago":
      return `${formatPrecio(Number(d.monto))} · ${MEDIOS_PAGO[d.medio as keyof typeof MEDIOS_PAGO] ?? d.medio} · ${d.meses} ${Number(d.meses) === 1 ? "mes" : "meses"}`;
    case "anular_pago":
      return `${formatPrecio(Number(d.monto))} · ${d.motivo}`;
    case "extender_prueba":
      return `${d.dias} días`;
    case "suspender":
      return d.motivo ? String(d.motivo) : "";
    case "eliminar_cuentas":
      return Array.isArray(d.cuentas) ? d.cuentas.join(", ") : "";
    case "cambiar_slug":
      return `${d.antes} → ${d.despues}`;
    default:
      return "";
  }
}

export default async function PaginaNegocioAdmin({ params }: PageProps<"/admin/negocios/[id]">) {
  const admin = await requerirAdmin();
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  let n: NegocioAdmin;
  try {
    const fila = await comoUsuario(admin.userId, (tx) =>
      tx.uno<{ d: NegocioAdmin }>(sql`select plataforma.admin_negocio(${id}) as d`),
    );
    if (!fila) notFound();
    n = fila.d;
  } catch (e) {
    if (esErrorPg(e) && e.message.includes("NO_ENCONTRADO")) notFound();
    throw e;
  }

  const dueno = n.equipo.find((u) => u.rol === "dueno");

  return (
    <div className="space-y-5">
      <EncabezadoPagina
        volver={{ href: "/admin", texto: "Negocios" }}
        titulo={
          <span className="flex flex-wrap items-center gap-2">
            {n.nombre} <InsigniaEstado estado={n.estado} />
          </span>
        }
        descripcion={
          <>
            {RUBROS[n.rubro as Rubro] ?? n.rubro} · alta {formatFechaCorta(n.created_at)} ·{" "}
            <a href={`/n/${n.slug}`} target="_blank" className="font-medium text-marca-700 hover:underline">
              /n/{n.slug} ↗
            </a>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-5">
          <Seccion titulo="Membresía">
            <LineaMembresia n={n} />
            <div className="border-t border-zinc-100 pt-3">
              <h3 className="mb-2 text-sm font-semibold">Registrar pago</h3>
              <FormularioPago negocioId={n.id} />
              <p className="mt-2 text-xs text-zinc-500">
                Suma los meses desde que termina lo que ya tiene (pago anterior o prueba), así pagar antes no le hace perder días.
              </p>
            </div>
          </Seccion>

          <Seccion titulo="Pagos">
            {n.pagos.length === 0 ? (
              <p className="text-sm text-zinc-500">Todavía no hay pagos.</p>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {n.pagos.map((p) => (
                  <li key={p.id} className={cx("py-2.5", p.anulado_at && "opacity-60")}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className={cx("text-sm font-semibold", p.anulado_at && "line-through")}>
                        {formatPrecio(p.monto)} · {MEDIOS_PAGO[p.medio] ?? p.medio} · {p.meses === 1 ? "1 mes" : `${p.meses} meses`}
                      </p>
                      <span className="text-xs text-zinc-500">{formatFechaHora(p.created_at)}</span>
                    </div>
                    <p className="text-xs text-zinc-500">
                      Cubre del {formatFechaCorta(p.periodo_desde)} al {formatFechaCorta(p.periodo_hasta)}
                      {p.nota ? ` · ${p.nota}` : ""}
                    </p>
                    {p.anulado_at ? (
                      <p className="text-xs text-red-700">Anulado: {p.anulado_motivo}</p>
                    ) : (
                      <AnularPago negocioId={n.id} pagoId={p.id} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Seccion>

          <Seccion titulo="Configuración (solo lectura)">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Dato etiqueta="Turnos últimos 30 días">{n.uso.turnos_30d}</Dato>
              <Dato etiqueta="Turnos por venir">{n.uso.turnos_futuros}</Dato>
              <Dato etiqueta="Reservas online (30 d)">{n.uso.online_30d}</Dato>
              <Dato etiqueta="Clientes">{n.uso.clientes}</Dato>
            </dl>
            <div className="border-t border-zinc-100 pt-3">
              <h3 className="mb-2 text-sm font-semibold">Profesionales</h3>
              {n.profesionales.length === 0 ? (
                <p className="text-sm text-amber-700">No cargó profesionales: la página no muestra horarios.</p>
              ) : (
                <ul className="space-y-2">
                  {n.profesionales.map((p) => (
                    <li key={p.id} className="text-sm">
                      <p className="font-medium">
                        {p.nombre}{" "}
                        {!p.activo ? <Insignia>Inactivo</Insignia> : null}
                        {p.tiene_usuario ? <span className="text-xs text-zinc-500"> · con usuario</span> : null}
                        <span className="text-xs text-zinc-500"> · {p.servicios} servicios</span>
                      </p>
                      <p className="text-xs text-zinc-500">
                        {p.horarios.length === 0 ? (
                          <span className="text-amber-700">Sin horarios cargados</span>
                        ) : (
                          p.horarios
                            .map((h) => `${DIAS_SEMANA[h.dia_semana].slice(0, 3)} ${h.desde.slice(0, 5)}–${h.hasta.slice(0, 5)}`)
                            .join(" · ")
                        )}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="border-t border-zinc-100 pt-3">
              <h3 className="mb-2 text-sm font-semibold">Servicios</h3>
              {n.servicios.length === 0 ? (
                <p className="text-sm text-amber-700">No cargó servicios.</p>
              ) : (
                <p className="text-sm text-zinc-700">
                  {n.servicios.map((s, i) => (
                    <span key={i} className={cx(!s.activo && "text-zinc-400 line-through")}>
                      {i > 0 ? " · " : ""}
                      {s.nombre} ({formatDuracion(s.duracion_min)})
                    </span>
                  ))}
                </p>
              )}
            </div>
          </Seccion>

          <Seccion titulo="Historial">
            {n.auditoria.length === 0 ? (
              <p className="text-sm text-zinc-500">Sin acciones todavía.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {n.auditoria.map((a, i) => (
                  <li key={i} className="flex flex-wrap gap-x-2">
                    <span className="text-xs text-zinc-500">{formatFechaHora(a.created_at)}</span>
                    <span className="font-medium">{ACCIONES_AUDITORIA[a.accion] ?? a.accion}</span>
                    <span className="text-zinc-600">{textoDetalle(a.accion, a.detalle)}</span>
                    {a.admin ? <span className="text-xs text-zinc-400">({a.admin})</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </Seccion>
        </div>

        <div className="space-y-5">
          <Seccion titulo="Contacto">
            {dueno ? (
              <div className="text-sm">
                <p className="font-semibold">{dueno.nombre}</p>
                <a href={`mailto:${dueno.email}`} className="break-all text-marca-700 hover:underline">
                  {dueno.email}
                </a>
                {!dueno.email_verificado ? <p className="text-xs text-amber-700">No confirmó su mail</p> : null}
                <p className="text-xs text-zinc-500">
                  Último ingreso: {dueno.ultimo_ingreso ? formatFechaHora(dueno.ultimo_ingreso) : "nunca"}
                </p>
              </div>
            ) : (
              <p className="text-sm text-zinc-500">Sin dueño.</p>
            )}
            {n.telefono && convieneAvisar(n) ? (
              <div className="space-y-1">
                <BotonAvisoWhatsApp
                  negocioId={n.id}
                  estado={n.estado}
                  href={linkWhatsApp(n.telefono, textoAvisoWhatsApp(n, dueno?.nombre ?? null))}
                />
                <p className="text-xs text-zinc-500">Abre el chat con {n.telefono} y el mensaje del vencimiento ya escrito.</p>
              </div>
            ) : n.telefono ? (
              <a
                href={linkWhatsApp(n.telefono)}
                target="_blank"
                className="inline-flex h-9 items-center rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                WhatsApp {n.telefono}
              </a>
            ) : null}
            {n.direccion ? <p className="text-xs text-zinc-500">{n.direccion}</p> : null}
            {n.equipo.length > 1 ? (
              <div className="border-t border-zinc-100 pt-2 text-xs text-zinc-600">
                <p className="mb-1 font-semibold">Equipo</p>
                {n.equipo
                  .filter((u) => u.rol !== "dueno")
                  .map((u) => (
                    <p key={u.id}>
                      {u.nombre} · {u.email}
                    </p>
                  ))}
              </div>
            ) : null}
          </Seccion>

          <Seccion titulo="Ayuda">
            <BotonLinkAcceso negocioId={n.id} />
            {dueno && !dueno.email_verificado ? <BotonReenviarVerificacion negocioId={n.id} /> : null}
            <div className="border-t border-zinc-100 pt-3">
              <FormularioSlug negocioId={n.id} slug={n.slug} />
            </div>
          </Seccion>

          <Seccion titulo="Prueba y baja">
            <FormularioExtender negocioId={n.id} />
            <div className="border-t border-zinc-100 pt-3">
              <FormularioSuspension negocioId={n.id} suspendido={n.estado === "suspendida"} />
            </div>
          </Seccion>

          <Seccion titulo="Notas internas">
            <FormularioNota negocioId={n.id} />
            {n.notas.length > 0 ? (
              <ul className="space-y-2 border-t border-zinc-100 pt-3">
                {n.notas.map((nt) => (
                  <li key={nt.id} className="text-sm">
                    <p className="whitespace-pre-wrap">{nt.texto}</p>
                    <p className="text-xs text-zinc-500">
                      {formatFechaHora(nt.created_at)}
                      {nt.autor ? ` · ${nt.autor}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}
          </Seccion>

          <Seccion titulo="Eliminar" className="border-red-200">
            <FormularioEliminar
              negocioId={n.id}
              nombre={n.nombre}
              cuentas={n.equipo.map((u) => ({ email: u.email, rol: u.rol }))}
            />
          </Seccion>
        </div>
      </div>
    </div>
  );
}
