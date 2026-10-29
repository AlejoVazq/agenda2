"use client";

import { BotonEnviar, MensajeAccion, useFormulario } from "@/components/formularios";
import { Campo, Input, Textarea } from "@/components/ui";
import type { Cliente } from "@/lib/tipos";
import { guardarCliente } from "../acciones";

export function FormularioCliente({ cliente }: { cliente: Cliente }) {
  const { estado, accion, valor, intento } = useFormulario(guardarCliente.bind(null, cliente.id));
  const e = estado.errores ?? {};
  return (
    <form key={intento} action={accion} className="space-y-4" noValidate>
      <MensajeAccion estado={estado} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Nombre" htmlFor="nombre" errores={e.nombre}>
          <Input id="nombre" name="nombre" defaultValue={valor("nombre", cliente.nombre)} required />
        </Campo>
        <Campo etiqueta="Celular" htmlFor="telefono" errores={e.telefono}>
          <Input id="telefono" name="telefono" type="tel" defaultValue={valor("telefono", cliente.telefono)} required />
        </Campo>
      </div>
      <Campo etiqueta="Email" htmlFor="email" errores={e.email}>
        <Input id="email" name="email" type="email" defaultValue={valor("email", cliente.email)} />
      </Campo>
      <Campo etiqueta="Notas internas" htmlFor="notas" errores={e.notas} ayuda="Solo las ve tu equipo (alergias, preferencias, etc.).">
        <Textarea id="notas" name="notas" rows={3} defaultValue={valor("notas", cliente.notas)} />
      </Campo>
      <BotonEnviar>Guardar</BotonEnviar>
    </form>
  );
}
