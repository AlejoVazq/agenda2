"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BotonEnviar, MensajeAccion, useFormulario } from "@/components/formularios";
import { MiniaturaProducto } from "@/components/miniatura-producto";
import { Aviso, Boton, Campo, Input, Insignia } from "@/components/ui";
import { formatFechaLarga, formatHora, formatPrecio } from "@/lib/fechas";
import type { MedioPago } from "@/lib/tipos";
import { MEDIOS_PEDIDO } from "@/lib/tipos";
import { pedir } from "./acciones";

export type ProductoTienda = {
  id: string;
  nombre: string;
  descripcion: string | null;
  precio: number;
  stock: number;
  foto: string | null;
};

type Props = {
  negocio: { id: string; slug: string; nombre: string; zona_horaria: string };
  productos: ProductoTienda[];
  tienda: { medios: MedioPago[]; transferencia_plazo_horas: number; efectivo_plazo_dias: number };
  turno: { token: string; nombre: string; email: string; telefono: string | null; inicio: string } | null;
};

/** Cantidad por producto, como se guarda en el navegador. */
type Carrito = Record<string, number>;

const MAX_POR_ITEM = 20;
const MAX_ITEMS = 20;

function leerCarrito(clave: string): Carrito {
  try {
    const crudo = localStorage.getItem(clave);
    if (!crudo) return {};
    const v: unknown = JSON.parse(crudo);
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const limpio: Carrito = {};
    for (const [id, c] of Object.entries(v)) {
      if (/^[0-9a-f-]{36}$/i.test(id) && Number.isInteger(c) && (c as number) > 0) limpio[id] = c as number;
    }
    return limpio;
  } catch {
    return {};
  }
}

function plural(n: number, uno: string, varios: string) {
  return `${n} ${n === 1 ? uno : varios}`;
}

function textoHoras(h: number) {
  return h % 24 === 0 ? plural(h / 24, "día", "días") : plural(h, "hora", "horas");
}

export function Tienda({ negocio, productos, tienda, turno }: Props) {
  const clave = `carrito:${negocio.slug}`;
  const [guardado, setGuardado] = useState<Carrito>({});
  const [paso, setPaso] = useState<"elegir" | "datos">("elegir");
  const [medio, setMedio] = useState<MedioPago | null>(tienda.medios.length === 1 ? tienda.medios[0]! : null);
  const { estado, accion, valor, intento } = useFormulario(pedir);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- se lee después de hidratar para no desfasar el HTML
    setGuardado(leerCarrito(clave));
  }, [clave]);

  // Lo que vale es lo guardado acotado al stock que se muestra hoy (puede haber bajado).
  const porId = new Map(productos.map((p) => [p.id, p]));
  const lineas = Object.entries(guardado).flatMap(([id, c]) => {
    const p = porId.get(id);
    if (!p || p.stock <= 0) return [];
    return [{ producto: p, cantidad: Math.min(c, p.stock, MAX_POR_ITEM) }];
  });
  const cantidades = new Map(lineas.map((l) => [l.producto.id, l.cantidad]));
  const unidades = lineas.reduce((s, l) => s + l.cantidad, 0);
  const total = lineas.reduce((s, l) => s + l.cantidad * l.producto.precio, 0);
  const pasoActual = lineas.length ? paso : "elegir";

  function cambiar(p: ProductoTienda, cantidad: number) {
    const n = Math.max(0, Math.min(cantidad, p.stock, MAX_POR_ITEM));
    setGuardado((prev) => {
      const sig = { ...prev };
      if (n === 0) delete sig[p.id];
      else sig[p.id] = n;
      try {
        localStorage.setItem(clave, JSON.stringify(sig));
      } catch {
        // Sin almacenamiento: el carrito vale solo para esta visita.
      }
      return sig;
    });
  }

  function irA(siguiente: "elegir" | "datos") {
    setPaso(siguiente);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const items = JSON.stringify(lineas.map((l) => ({ producto_id: l.producto.id, cantidad: l.cantidad })));
  const tz = negocio.zona_horaria;

  if (pasoActual === "elegir") {
    return (
      <>
        <ul className="mt-6 animate-aparecer divide-y divide-zinc-100 rounded-[2rem] bg-white px-4 shadow-suave ring-1 ring-zinc-200/60 retraso-2 sm:px-6">
          {productos.map((p) => {
            const enCarrito = cantidades.get(p.id) ?? 0;
            const tope = Math.min(p.stock, MAX_POR_ITEM);
            return (
              <li key={p.id} id={`producto-${p.id}`} className="flex scroll-mt-6 gap-3 py-4">
                <MiniaturaProducto nombre={p.nombre} url={p.foto} className="size-20 rounded-2xl" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-snug [overflow-wrap:anywhere]">{p.nombre}</p>
                  {p.descripcion ? (
                    <p className="mt-0.5 line-clamp-2 text-sm text-zinc-600 [overflow-wrap:anywhere]">{p.descripcion}</p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="font-bold tabular-nums">{formatPrecio(p.precio)}</p>
                    {p.stock <= 0 ? (
                      <Insignia color="gris">Sin stock</Insignia>
                    ) : enCarrito ? (
                      <Contador
                        nombre={p.nombre}
                        cantidad={enCarrito}
                        tope={tope}
                        onCambiar={(n) => cambiar(p, n)}
                      />
                    ) : (
                      <Boton
                        type="button"
                        variante="secundario"
                        tamano="sm"
                        className="rounded-full px-4"
                        disabled={lineas.length >= MAX_ITEMS}
                        onClick={() => cambiar(p, 1)}
                      >
                        Agregar
                      </Boton>
                    )}
                  </div>
                  {p.stock > 0 && p.stock <= 3 ? (
                    <p className="mt-1 text-xs font-medium text-amber-700">
                      {p.stock === 1 ? "Queda 1" : `Quedan ${p.stock}`}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>

        {lineas.length ? (
          <div className="fixed inset-x-0 bottom-0 z-20 animate-asomar border-t border-zinc-200/70 bg-white/90 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
            <div className="mx-auto flex max-w-xl items-center gap-3 px-4">
              <div className="min-w-0 flex-1 text-sm">
                <p className="text-zinc-600">{plural(unidades, "producto", "productos")}</p>
                <p className="font-display text-lg font-bold tabular-nums leading-tight">{formatPrecio(total)}</p>
              </div>
              <Boton type="button" tamano="lg" onClick={() => irA("datos")}>
                Continuar
              </Boton>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <section aria-labelledby="t-pedido" className="mt-6 animate-paso">
      <button
        type="button"
        onClick={() => irA("elegir")}
        className="mb-3 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-semibold text-marca-800 transition hover:bg-white"
      >
        <svg viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden>
          <path d="m15 6-6 6 6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Seguir eligiendo
      </button>

      <div className="rounded-[2rem] bg-white p-4 shadow-flotante ring-1 ring-zinc-200/60 sm:p-6">
        <h2 id="t-pedido" className="font-display text-xl font-bold">
          Tu pedido
        </h2>
        <ul className="mt-3 divide-y divide-dashed divide-zinc-200 text-sm">
          {lineas.map((l) => (
            <li key={l.producto.id} className="flex items-start justify-between gap-3 py-2.5">
              <span className="min-w-0 [overflow-wrap:anywhere]">
                <span className="font-semibold tabular-nums">{l.cantidad} ×</span> {l.producto.nombre}
              </span>
              <span className="shrink-0 font-semibold tabular-nums">{formatPrecio(l.cantidad * l.producto.precio)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-1 flex items-baseline justify-between border-t border-zinc-200 pt-3">
          <span className="text-sm font-semibold text-zinc-600">Total</span>
          <span className="font-display text-2xl font-bold tabular-nums">{formatPrecio(total)}</span>
        </p>

        {turno ? (
          <Aviso tipo="info" className="mt-4">
            <p className="font-semibold">Lo retirás el día de tu turno</p>
            <p className="mt-0.5 first-letter:uppercase">
              {formatFechaLarga(turno.inicio, tz)} · {formatHora(turno.inicio, tz)} h
            </p>
          </Aviso>
        ) : null}

        <form key={intento} action={accion} className="mt-6 space-y-4" noValidate>
          <input type="hidden" name="negocio_id" value={negocio.id} />
          <input type="hidden" name="slug" value={negocio.slug} />
          <input type="hidden" name="items" value={items} />
          {turno ? <input type="hidden" name="turno_token" value={turno.token} /> : null}

          <h3 className="font-display text-lg font-bold">Tus datos</h3>
          <Campo etiqueta="Nombre y apellido" htmlFor="nombre" errores={estado.errores?.nombre}>
            <Input id="nombre" name="nombre" autoComplete="name" defaultValue={valor("nombre", turno?.nombre)} required />
          </Campo>
          <Campo
            etiqueta="Celular"
            htmlFor="telefono"
            errores={estado.errores?.telefono}
            ayuda="Con código de área, sin 0 ni 15. Ej: 341 555 1234"
          >
            <Input
              id="telefono"
              name="telefono"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              defaultValue={valor("telefono", turno?.telefono)}
              required
            />
          </Campo>
          <Campo etiqueta="Email" htmlFor="email" errores={estado.errores?.email} ayuda="Te mandamos el pedido y cómo pagarlo.">
            <Input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              defaultValue={valor("email", turno?.email)}
              required
            />
          </Campo>

          <fieldset className="space-y-2 pt-2">
            <legend className="mb-2 font-display text-lg font-bold">Cómo pagás</legend>
            {tienda.medios.map((m) => (
              <label
                key={m}
                className="flex cursor-pointer items-start gap-3 rounded-2xl border border-zinc-200 bg-white p-4 transition-colors hover:border-marca-300 has-[:checked]:border-marca-400 has-[:checked]:bg-marca-50/60"
              >
                <input
                  type="radio"
                  name="medio"
                  value={m}
                  checked={medio === m}
                  onChange={() => setMedio(m)}
                  className="mt-0.5 size-5 shrink-0 accent-marca-700"
                />
                <span className="min-w-0">
                  <span className="block font-semibold text-tinta">{MEDIOS_PEDIDO[m]}</span>
                  <span className="mt-0.5 block text-sm text-zinc-600">
                    {m === "mercadopago"
                      ? "Pagás ahora con tarjeta o dinero en cuenta. Te lo guardamos 30 minutos mientras pagás."
                      : m === "transferencia"
                        ? `Te pasamos el alias y tenés ${textoHoras(tienda.transferencia_plazo_horas)} para transferir.`
                        : turno
                          ? "Pagás cuando lo retirás, el día de tu turno."
                          : `Pagás cuando lo retirás. Te lo guardamos ${plural(tienda.efectivo_plazo_dias, "día", "días")}.`}
                  </span>
                </span>
              </label>
            ))}
            {estado.errores?.medio ? (
              <p className="text-sm text-red-600" role="alert">
                {estado.errores.medio[0]}
              </p>
            ) : null}
          </fieldset>

          {estado.errores?.items ? <Aviso tipo="error">{estado.errores.items[0]}</Aviso> : null}
          <MensajeAccion estado={estado} />

          <BotonEnviar
            tamano="lg"
            className="w-full"
            pendiente={medio === "mercadopago" ? "Preparando el pago…" : "Enviando el pedido…"}
          >
            {medio === "mercadopago" ? `Ir a pagar ${formatPrecio(total)}` : "Confirmar pedido"}
          </BotonEnviar>
          <p className="text-center text-xs text-zinc-500">
            Podés cancelarlo desde el link del pedido mientras no esté pagado. Usamos tus datos para gestionar tu pedido.{" "}
            <Link href="/privacidad" target="_blank" className="underline">
              Ver privacidad
            </Link>
          </p>
        </form>
      </div>
    </section>
  );
}

function Contador({
  nombre,
  cantidad,
  tope,
  onCambiar,
}: {
  nombre: string;
  cantidad: number;
  tope: number;
  onCambiar: (n: number) => void;
}) {
  const boton =
    "grid size-9 place-items-center rounded-full text-marca-800 transition-colors hover:bg-marca-100 disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div className="flex items-center gap-1 rounded-full bg-marca-50 p-0.5 ring-1 ring-marca-100">
      <button type="button" className={boton} onClick={() => onCambiar(cantidad - 1)} aria-label={`Quitar uno: ${nombre}`}>
        <svg viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden>
          <path d="M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      </button>
      <span className="min-w-6 text-center font-bold tabular-nums" aria-live="polite">
        {cantidad}
      </span>
      <button
        type="button"
        className={boton}
        onClick={() => onCambiar(cantidad + 1)}
        disabled={cantidad >= tope}
        aria-label={`Agregar uno: ${nombre}`}
      >
        <svg viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden>
          <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
