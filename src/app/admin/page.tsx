import Link from "next/link";
import { EncabezadoPagina, Input, Vacio, cx } from "@/components/ui";
import { requerirAdmin } from "@/lib/admin";
import { comoUsuario, sql } from "@/lib/db";
import { formatFechaCorta } from "@/lib/fechas";
import { diasHasta, ETIQUETA_ESTADO, type EstadoSuscripcion } from "@/lib/suscripcion";
import { RUBROS, type Rubro } from "@/lib/tipos";
import { InsigniaEstado } from "./estado";
import type { FilaNegocioAdmin } from "./tipos";

const FILTROS = ["todos", "por_vencer", "prueba", "activa", "gracia", "vencida", "suspendida"] as const;
type Filtro = (typeof FILTROS)[number];
const ETIQUETA_FILTRO: Record<Filtro, string> = {
  todos: "Todos",
  por_vencer: "Vencen en 7 días",
  ...(ETIQUETA_ESTADO as Record<EstadoSuscripcion, string>),
};

/** Fin de lo que tiene pago o de la prueba (lo que vence). */
const vence = (n: FilaNegocioAdmin) => n.pagado_hasta && n.pagado_hasta > n.prueba_hasta ? n.pagado_hasta : n.prueba_hasta;

function porVencer(n: FilaNegocioAdmin) {
  if (n.estado === "suspendida") return false;
  return n.estado === "gracia" || ((n.estado === "prueba" || n.estado === "activa") && diasHasta(vence(n)) <= 7);
}

export default async function PaginaAdmin({ searchParams }: PageProps<"/admin">) {
  const admin = await requerirAdmin();
  const { filtro: f, q } = await searchParams;
  const filtro: Filtro = FILTROS.includes(f as Filtro) ? (f as Filtro) : "todos";
  const busqueda = typeof q === "string" ? q.trim().toLowerCase().slice(0, 80) : "";

  const negocios = await comoUsuario(admin.userId, (tx) =>
    tx.varios<FilaNegocioAdmin>(sql`select * from plataforma.admin_negocios()`),
  );

  const cuenta = (fn: (n: FilaNegocioAdmin) => boolean) => negocios.filter(fn).length;
  const conteos: Record<Filtro, number> = {
    todos: negocios.length,
    por_vencer: cuenta(porVencer),
    prueba: cuenta((n) => n.estado === "prueba"),
    activa: cuenta((n) => n.estado === "activa"),
    gracia: cuenta((n) => n.estado === "gracia"),
    vencida: cuenta((n) => n.estado === "vencida"),
    suspendida: cuenta((n) => n.estado === "suspendida"),
  };

  const visibles = negocios
    .filter((n) => (filtro === "todos" ? true : filtro === "por_vencer" ? porVencer(n) : n.estado === filtro))
    .filter(
      (n) =>
        !busqueda ||
        [n.nombre, n.slug, n.dueno_nombre, n.dueno_email, n.telefono].some((v) => v?.toLowerCase().includes(busqueda)),
    );

  const enlace = (nuevo: Filtro) => {
    const p = new URLSearchParams();
    if (nuevo !== "todos") p.set("filtro", nuevo);
    if (busqueda) p.set("q", busqueda);
    const s = p.toString();
    return s ? `/admin?${s}` : "/admin";
  };

  return (
    <div>
      <EncabezadoPagina
        titulo="Negocios"
        descripcion={`${conteos.activa} pagos · ${conteos.prueba} en prueba · ${conteos.gracia + conteos.vencida} vencidos o por vencer`}
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          {FILTROS.map((x) => (
            <Link
              key={x}
              href={enlace(x)}
              className={cx(
                "shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition",
                x === filtro ? "border-tinta bg-tinta text-white" : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300",
              )}
            >
              {ETIQUETA_FILTRO[x]} <span className="opacity-60">{conteos[x]}</span>
            </Link>
          ))}
        </div>
        <form className="sm:w-72" action="/admin">
          {filtro !== "todos" ? <input type="hidden" name="filtro" value={filtro} /> : null}
          <Input name="q" type="search" placeholder="Buscar nombre, mail, teléfono…" defaultValue={busqueda} aria-label="Buscar" />
        </form>
      </div>

      {visibles.length === 0 ? (
        <Vacio titulo="No hay negocios con ese filtro" />
      ) : (
        <ul className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
          {visibles.map((n) => (
            <li key={n.id}>
              <Link href={`/admin/negocios/${n.id}`} className="block px-4 py-3.5 transition hover:bg-zinc-50">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{n.nombre}</p>
                    <p className="truncate text-sm text-zinc-500">
                      {n.dueno_nombre ?? "Sin dueño"} · {n.dueno_email ?? "—"}
                      {n.dueno_verificado === false ? <span className="text-amber-700"> (sin confirmar)</span> : null}
                    </p>
                  </div>
                  <InsigniaEstado estado={n.estado} />
                </div>
                <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-zinc-500">
                  <span>{RUBROS[n.rubro as Rubro] ?? n.rubro}</span>
                  <span>Alta {formatFechaCorta(n.created_at)}</span>
                  <span>
                    {n.estado === "suspendida"
                      ? "Suspendido"
                      : n.estado === "vencida" || n.estado === "gracia"
                        ? `Venció ${formatFechaCorta(vence(n))}`
                        : `Vence ${formatFechaCorta(vence(n))} (${diasHasta(vence(n))} d)`}
                  </span>
                  <span>{n.turnos_30d} turnos en 30 días</span>
                  <span>Último ingreso {n.ultimo_ingreso ? formatFechaCorta(n.ultimo_ingreso) : "—"}</span>
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
