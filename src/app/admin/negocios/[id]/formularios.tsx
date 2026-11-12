"use client";

import { useState } from "react";
import { BotonEnviar, MensajeAccion, useFormulario } from "@/components/formularios";
import { BotonCopiar } from "@/components/copiar";
import { Aviso, Boton, Campo, Input, Select, Textarea } from "@/components/ui";
import type { EstadoAccion } from "@/lib/tipos";
import {
  agregarNota,
  anularPago,
  cambiarSlug,
  extenderPrueba,
  linkAccesoDueno,
  reactivar,
  reenviarVerificacion,
  registrarPago,
  suspender,
} from "../../acciones";
import { MEDIOS_PAGO } from "../../tipos";

type Accion = (prev: EstadoAccion, formData: FormData) => Promise<EstadoAccion>;

function Oculto({ negocioId }: { negocioId: string }) {
  return <input type="hidden" name="negocio_id" value={negocioId} />;
}

export function FormularioPago({ negocioId }: { negocioId: string }) {
  const { estado, accion, valor, intento } = useFormulario(registrarPago);
  const e = estado.errores ?? {};
  return (
    <form key={intento} action={accion} className="space-y-3" noValidate>
      <Oculto negocioId={negocioId} />
      <MensajeAccion estado={estado} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Campo etiqueta="Monto ($)" htmlFor="pago-monto" errores={e.monto}>
          <Input id="pago-monto" name="monto" inputMode="decimal" defaultValue={valor("monto")} required />
        </Campo>
        <Campo etiqueta="Medio" htmlFor="pago-medio" errores={e.medio}>
          <Select id="pago-medio" name="medio" defaultValue={valor("medio", "transferencia")}>
            {Object.entries(MEDIOS_PAGO).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Campo>
        <Campo etiqueta="Meses" htmlFor="pago-meses" errores={e.meses}>
          <Select id="pago-meses" name="meses" defaultValue={valor("meses", "1")}>
            {[1, 2, 3, 6, 12].map((m) => (
              <option key={m} value={m}>
                {m === 1 ? "1 mes" : `${m} meses`}
              </option>
            ))}
          </Select>
        </Campo>
      </div>
      <Campo etiqueta="Nota (opcional)" htmlFor="pago-nota" errores={e.nota}>
        <Input id="pago-nota" name="nota" defaultValue={valor("nota")} placeholder="Ej: noviembre, transferencia del 3/11" />
      </Campo>
      <BotonEnviar pendiente="Registrando…">Registrar pago</BotonEnviar>
    </form>
  );
}

export function AnularPago({ negocioId, pagoId }: { negocioId: string; pagoId: string }) {
  const [abierto, setAbierto] = useState(false);
  const { estado, accion } = useFormulario(anularPago);
  if (!abierto) {
    return (
      <button type="button" className="text-xs font-medium text-red-600 hover:underline" onClick={() => setAbierto(true)}>
        Anular
      </button>
    );
  }
  return (
    <form action={accion} className="mt-2 flex flex-wrap items-start gap-2" noValidate>
      <Oculto negocioId={negocioId} />
      <input type="hidden" name="pago_id" value={pagoId} />
      <Input name="motivo" placeholder="Motivo (ej: cargado dos veces)" className="h-9 min-w-48 flex-1 text-sm" aria-label="Motivo" autoFocus />
      <BotonEnviar variante="peligro" tamano="sm" pendiente="Anulando…">
        Anular pago
      </BotonEnviar>
      <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setAbierto(false)}>
        Cancelar
      </Boton>
      <div className="w-full">
        <MensajeAccion estado={estado} />
        {estado.errores?.motivo ? <p className="text-xs text-red-600">{estado.errores.motivo[0]}</p> : null}
      </div>
    </form>
  );
}

export function FormularioExtender({ negocioId }: { negocioId: string }) {
  const { estado, accion } = useFormulario(extenderPrueba);
  return (
    <form action={accion} className="space-y-2" noValidate>
      <Oculto negocioId={negocioId} />
      <MensajeAccion estado={estado} />
      <div className="flex gap-2">
        <Select name="dias" defaultValue="7" aria-label="Días" className="w-32">
          {[3, 7, 14, 30].map((d) => (
            <option key={d} value={d}>
              {d} días
            </option>
          ))}
        </Select>
        <BotonEnviar variante="secundario" pendiente="Extendiendo…">
          Extender prueba
        </BotonEnviar>
      </div>
    </form>
  );
}

export function FormularioSuspension({ negocioId, suspendido }: { negocioId: string; suspendido: boolean }) {
  const [confirmar, setConfirmar] = useState(false);
  const { estado: estadoS, accion: accionS } = useFormulario(suspender);
  const { estado: estadoR, accion: accionR } = useFormulario(reactivar);

  if (suspendido) {
    return (
      <form action={accionR} className="space-y-2">
        <Oculto negocioId={negocioId} />
        <MensajeAccion estado={estadoR} />
        <BotonEnviar pendiente="Reactivando…">Reactivar negocio</BotonEnviar>
      </form>
    );
  }
  if (!confirmar) {
    return (
      <div className="space-y-2">
        <MensajeAccion estado={estadoS} />
        <Boton type="button" variante="secundario" className="text-red-700" onClick={() => setConfirmar(true)}>
          Suspender…
        </Boton>
      </div>
    );
  }
  return (
    <form action={accionS} className="space-y-2" noValidate>
      <Oculto negocioId={negocioId} />
      <Campo
        etiqueta="Motivo (lo ve el dueño)"
        htmlFor="susp-motivo"
        ayuda="El panel queda en solo lectura y la página no toma reservas nuevas. Los turnos ya reservados siguen."
      >
        <Input id="susp-motivo" name="motivo" placeholder="Ej: falta el pago de noviembre" />
      </Campo>
      <div className="flex gap-2">
        <BotonEnviar variante="peligro" pendiente="Suspendiendo…">
          Suspender
        </BotonEnviar>
        <Boton type="button" variante="fantasma" onClick={() => setConfirmar(false)}>
          Cancelar
        </Boton>
      </div>
    </form>
  );
}

export function FormularioNota({ negocioId }: { negocioId: string }) {
  const { estado, accion, intento } = useFormulario(agregarNota);
  return (
    <form key={intento} action={accion} className="space-y-2" noValidate>
      <Oculto negocioId={negocioId} />
      <MensajeAccion estado={estado} />
      <Textarea name="texto" rows={2} placeholder="Nota interna (solo la ven los admins)" aria-label="Nota" />
      {estado.errores?.texto ? <p className="text-xs text-red-600">{estado.errores.texto[0]}</p> : null}
      <BotonEnviar variante="secundario" tamano="sm" pendiente="Guardando…">
        Guardar nota
      </BotonEnviar>
    </form>
  );
}

export function FormularioSlug({ negocioId, slug }: { negocioId: string; slug: string }) {
  const { estado, accion, valor } = useFormulario(cambiarSlug);
  return (
    <form action={accion} className="space-y-2" noValidate>
      <Oculto negocioId={negocioId} />
      <MensajeAccion estado={estado} />
      <Campo etiqueta="Dirección de la página" htmlFor="slug" errores={estado.errores?.slug}>
        <div className="flex items-center gap-1">
          <span className="text-sm text-zinc-500">/n/</span>
          <Input id="slug" name="slug" defaultValue={valor("slug", slug)} />
        </div>
      </Campo>
      <BotonEnviar variante="secundario" tamano="sm" pendiente="Guardando…">
        Cambiar dirección
      </BotonEnviar>
    </form>
  );
}

export function BotonLinkAcceso({ negocioId }: { negocioId: string }) {
  const { estado, accion } = useFormulario(linkAccesoDueno);
  return (
    <form action={accion} className="space-y-2">
      <Oculto negocioId={negocioId} />
      {estado.link ? (
        <Aviso tipo="exito" className="space-y-2">
          <p>{estado.mensaje}</p>
          <p className="break-all rounded-lg bg-white/70 px-2 py-1.5 font-mono text-xs">{estado.link}</p>
          <BotonCopiar texto={estado.link} />
        </Aviso>
      ) : (
        <MensajeAccion estado={estado} />
      )}
      <BotonEnviar variante="secundario" tamano="sm" pendiente="Generando…">
        Link para elegir contraseña nueva
      </BotonEnviar>
    </form>
  );
}

export function BotonReenviarVerificacion({ negocioId }: { negocioId: string }) {
  const { estado, accion } = useFormulario(reenviarVerificacion as Accion);
  return (
    <form action={accion} className="space-y-2">
      <Oculto negocioId={negocioId} />
      <MensajeAccion estado={estado} />
      <BotonEnviar variante="secundario" tamano="sm" pendiente="Enviando…">
        Reenviar mail de confirmación
      </BotonEnviar>
    </form>
  );
}
