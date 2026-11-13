"use client";

import { useState, useTransition } from "react";
import { BotonEnviar, MensajeAccion, useFormulario } from "@/components/formularios";
import { BotonCopiar } from "@/components/copiar";
import { Aviso, Boton, Campo, Casilla, Input, Select, Textarea } from "@/components/ui";
import type { EstadoAccion } from "@/lib/tipos";
import {
  agregarNota,
  anularPago,
  cambiarSlug,
  eliminar,
  extenderPrueba,
  linkAccesoDueno,
  reactivar,
  reenviarVerificacion,
  registrarAvisoWhatsApp,
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
        <p className="text-xs text-zinc-500">Vuelve a funcionar según lo que tenga pago (o la prueba).</p>
      </form>
    );
  }
  if (!confirmar) {
    return (
      <div className="space-y-2">
        <MensajeAccion estado={estadoS} />
        <Boton type="button" variante="secundario" className="text-red-700" onClick={() => setConfirmar(true)}>
          Dar de baja…
        </Boton>
        <p className="text-xs text-zinc-500">
          Lo apaga ya, aunque tenga días pagos: no entra al panel y su página no toma reservas. Se puede reactivar.
        </p>
      </div>
    );
  }
  return (
    <form action={accionS} className="space-y-2" noValidate>
      <Oculto negocioId={negocioId} />
      <Campo
        etiqueta="Motivo (lo ve el dueño)"
        htmlFor="susp-motivo"
        ayuda="No entra al panel y su página no toma reservas nuevas. Los turnos ya reservados y sus datos quedan."
      >
        <Input id="susp-motivo" name="motivo" placeholder="Ej: falta el pago de noviembre" />
      </Campo>
      <div className="flex gap-2">
        <BotonEnviar variante="peligro" pendiente="Dando de baja…">
          Dar de baja
        </BotonEnviar>
        <Boton type="button" variante="fantasma" onClick={() => setConfirmar(false)}>
          Cancelar
        </Boton>
      </div>
    </form>
  );
}

export function FormularioEliminar({
  negocioId,
  nombre,
  cuentas,
}: {
  negocioId: string;
  nombre: string;
  cuentas: { email: string; rol: "dueno" | "empleado" }[];
}) {
  const [abierto, setAbierto] = useState(false);
  const { estado, accion, valor } = useFormulario(eliminar);
  if (!abierto) {
    return (
      <div className="space-y-2">
        <MensajeAccion estado={estado} />
        <Boton type="button" variante="peligro" onClick={() => setAbierto(true)}>
          Eliminar…
        </Boton>
        <p className="text-xs text-zinc-500">Borra para siempre. Para frenarlo un tiempo, mejor dalo de baja.</p>
      </div>
    );
  }
  return (
    <form action={accion} className="space-y-3" noValidate>
      <Oculto negocioId={negocioId} />
      <MensajeAccion estado={estado} />
      <Casilla
        name="borrar_negocio"
        defaultChecked
        etiqueta="El negocio y todos sus datos"
        descripcion="Página, equipo, servicios, horarios, clientes, turnos, logo, pagos y notas."
      />
      <Casilla
        name="borrar_cuentas"
        defaultChecked={cuentas.length > 0}
        disabled={cuentas.length === 0}
        etiqueta="Las cuentas del dueño y su equipo"
        descripcion={
          cuentas.length === 0
            ? "No tiene cuentas."
            : `${cuentas.map((c) => c.email).join(", ")}. Si no las borrás, pueden volver a entrar y crear otro negocio.`
        }
      />
      <Campo
        etiqueta={<>Para confirmar, escribí <span className="font-semibold">{nombre}</span></>}
        htmlFor="eliminar-confirmacion"
        errores={estado.errores?.confirmacion}
      >
        <Input id="eliminar-confirmacion" name="confirmacion" autoComplete="off" defaultValue={valor("confirmacion")} />
      </Campo>
      <Aviso tipo="error">No se puede deshacer. Queda registrado en el historial de administración.</Aviso>
      <div className="flex gap-2">
        <BotonEnviar variante="peligro" pendiente="Eliminando…">
          Eliminar para siempre
        </BotonEnviar>
        <Boton type="button" variante="fantasma" onClick={() => setAbierto(false)}>
          Cancelar
        </Boton>
      </div>
    </form>
  );
}

/** Abre WhatsApp con el aviso ya escrito y lo deja en el historial. */
export function BotonAvisoWhatsApp({ negocioId, estado, href }: { negocioId: string; estado: string; href: string }) {
  const [, iniciar] = useTransition();
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      onClick={() => iniciar(() => registrarAvisoWhatsApp(negocioId, estado))}
      className="inline-flex h-9 items-center gap-2 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700"
    >
      Avisar por WhatsApp
    </a>
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
