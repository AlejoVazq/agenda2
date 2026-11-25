"use client";

import { useState, useTransition } from "react";
import { BotonEnviar, MensajeAccion, useFormulario } from "@/components/formularios";
import { Aviso, Boton, Campo, Casilla, Input, Textarea } from "@/components/ui";
import type { EstadoAccion, Producto } from "@/lib/tipos";
import { borrarProducto, guardarProducto } from "./acciones";

export function FormularioProducto({ producto }: { producto?: Producto }) {
  const { estado, accion, valor, marcado, intento } = useFormulario(guardarProducto.bind(null, producto?.id ?? null));

  return (
    <form key={intento} action={accion} className="space-y-5" noValidate>
      <MensajeAccion estado={estado} />
      {/* El disponible que se vio al abrir: se guarda la diferencia, así no pisa lo pedido mientras tanto. */}
      {producto ? <input type="hidden" name="stock_original" value={producto.stock} /> : null}
      <Campo etiqueta="Nombre" htmlFor="nombre" errores={estado.errores?.nombre}>
        <Input id="nombre" name="nombre" defaultValue={valor("nombre", producto?.nombre)} placeholder="Ej: Cera mate" maxLength={80} required />
      </Campo>
      <div className="grid gap-5 sm:grid-cols-2">
        <Campo etiqueta="Precio ($)" htmlFor="precio" errores={estado.errores?.precio}>
          <Input
            id="precio"
            name="precio"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            defaultValue={valor("precio", producto?.precio)}
            placeholder="8500"
            required
          />
        </Campo>
        <Campo
          etiqueta="Disponible"
          htmlFor="stock"
          errores={estado.errores?.stock}
          ayuda="Unidades que se pueden pedir. Lo pedido se descuenta solo."
        >
          <Input
            id="stock"
            name="stock"
            type="number"
            inputMode="numeric"
            min={0}
            max={100000}
            step={1}
            defaultValue={valor("stock", producto?.stock ?? 0)}
            required
          />
        </Campo>
      </div>
      <Campo etiqueta="Descripción" htmlFor="descripcion" errores={estado.errores?.descripcion} ayuda="Opcional.">
        <Textarea id="descripcion" name="descripcion" defaultValue={valor("descripcion", producto?.descripcion)} rows={3} maxLength={500} />
      </Campo>
      <Campo
        etiqueta="Orden"
        htmlFor="orden"
        errores={estado.errores?.orden}
        ayuda="Opcional. Los de número más chico se muestran primero."
      >
        <Input
          id="orden"
          name="orden"
          type="number"
          inputMode="numeric"
          step={1}
          defaultValue={valor("orden", producto?.orden ?? "")}
          className="max-w-32"
        />
      </Campo>
      <Casilla
        name="activo"
        defaultChecked={marcado("activo", producto?.activo ?? true)}
        etiqueta="Mostrar en tu página"
        descripcion="Si lo desactivás, deja de aparecer en la tienda pero los pedidos hechos se conservan."
      />
      <BotonEnviar tamano="lg" className="w-full sm:w-auto">
        {producto ? "Guardar cambios" : "Crear producto"}
      </BotonEnviar>
    </form>
  );
}

export function BorrarProducto({ id }: { id: string }) {
  const [confirmar, setConfirmar] = useState(false);
  const [estado, setEstado] = useState<EstadoAccion>();
  const [pendiente, iniciar] = useTransition();

  return (
    <div className="space-y-3">
      {estado?.error ? <Aviso tipo="error">{estado.error}</Aviso> : null}
      {confirmar ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-zinc-700">¿Seguro? Los pedidos hechos conservan el nombre y el precio.</span>
          <Boton
            variante="peligro"
            tamano="sm"
            disabled={pendiente}
            onClick={() => iniciar(async () => setEstado(await borrarProducto(id)))}
          >
            {pendiente ? "Eliminando…" : "Sí, eliminar"}
          </Boton>
          <Boton variante="fantasma" tamano="sm" onClick={() => setConfirmar(false)}>
            Cancelar
          </Boton>
        </div>
      ) : (
        <Boton variante="peligro" tamano="sm" onClick={() => setConfirmar(true)}>
          Eliminar producto
        </Boton>
      )}
    </div>
  );
}
