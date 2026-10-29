"use client";

import { useState, useTransition } from "react";
import { BotonAccion } from "@/components/boton-accion";
import { BotonEnviar, MensajeAccion, useFormulario } from "@/components/formularios";
import { Campo, Casilla, cx, Input, Select } from "@/components/ui";
import type { Negocio } from "@/lib/tipos";
import {
  cambiarImportarOcupado,
  conectarMercadoPago,
  desconectarCalendario,
  desconectarMercadoPago,
  guardarSena,
  guardarWhatsApp,
  sincronizarCalendario,
} from "./acciones";

// --- Google Calendar -------------------------------------------------------------------

export function AccionesCalendario({ profesionalId, importarOcupado }: { profesionalId: string; importarOcupado: boolean }) {
  const [importar, setImportar] = useState(importarOcupado);
  const [enCurso, iniciar] = useTransition();

  return (
    <div className="space-y-3">
      <label className="flex cursor-pointer items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-5 shrink-0 accent-marca-700"
          checked={importar}
          disabled={enCurso}
          onChange={(e) => {
            const valor = e.target.checked;
            setImportar(valor);
            iniciar(async () => {
              const r = await cambiarImportarOcupado(profesionalId, valor);
              if (r.error) setImportar(!valor);
            });
          }}
        />
        <span>
          <span className="font-medium">No ofrecer horarios ocupados en Google</span>
          <span className="block text-xs text-zinc-500">
            Lo que tengas agendado en Google (y no esté marcado como “disponible”) se bloquea para reservas online.
          </span>
        </span>
      </label>
      <div className="flex flex-wrap gap-2">
        <BotonAccion accion={() => sincronizarCalendario(profesionalId)} pendiente="Sincronizando…">
          Sincronizar ahora
        </BotonAccion>
        <BotonAccion
          accion={() => desconectarCalendario(profesionalId)}
          confirmar="Sí, desconectar"
          variante="peligro"
          pendiente="Desconectando…"
        >
          Desconectar
        </BotonAccion>
      </div>
    </div>
  );
}

// --- Mercado Pago ------------------------------------------------------------------------

export function FormularioMercadoPago() {
  const { estado, accion, valor, intento } = useFormulario(conectarMercadoPago);
  return (
    <form key={intento} action={accion} className="space-y-4" noValidate>
      <MensajeAccion estado={estado} />
      <Campo
        etiqueta="Access Token de producción"
        htmlFor="access_token"
        errores={estado.errores?.access_token}
        ayuda={
          <>
            Lo encontrás en{" "}
            <a href="https://www.mercadopago.com.ar/developers/panel/app" target="_blank" className="font-semibold text-marca-700 underline">
              Mercado Pago Developers
            </a>{" "}
            → tu aplicación → Credenciales de producción. Se guarda cifrado y nadie más lo puede ver.
          </>
        }
      >
        <Input
          id="access_token"
          name="access_token"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="APP_USR-…"
          defaultValue={valor("access_token")}
          required
        />
      </Campo>
      <BotonEnviar pendiente="Verificando…">Conectar Mercado Pago</BotonEnviar>
    </form>
  );
}

export function DesconectarMercadoPago() {
  return (
    <BotonAccion accion={desconectarMercadoPago} confirmar="Sí, desconectar" variante="peligro" pendiente="Desconectando…">
      Desconectar
    </BotonAccion>
  );
}

export function FormularioSena({ negocio, conectado }: { negocio: Negocio; conectado: boolean }) {
  const { estado, accion, valor, intento } = useFormulario(guardarSena);
  const [tipo, setTipo] = useState<string>(String(valor("sena_tipo", negocio.sena_tipo)));

  return (
    <form key={intento} action={accion} className="space-y-4" noValidate>
      <MensajeAccion estado={estado} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Campo etiqueta="Seña al reservar" htmlFor="sena_tipo" errores={estado.errores?.sena_tipo}>
          <Select id="sena_tipo" name="sena_tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="ninguna">No pedir seña</option>
            <option value="porcentaje">Porcentaje del precio</option>
            <option value="fijo">Monto fijo</option>
          </Select>
        </Campo>
        {tipo !== "ninguna" ? (
          <Campo
            etiqueta={tipo === "porcentaje" ? "Porcentaje" : "Monto"}
            htmlFor="sena_valor"
            errores={estado.errores?.sena_valor}
            ayuda={tipo === "porcentaje" ? "Servicios sin precio no piden seña." : "Si el servicio sale menos, se cobra el precio."}
          >
            <div className="relative">
              <Input
                id="sena_valor"
                name="sena_valor"
                inputMode="decimal"
                defaultValue={valor("sena_valor", negocio.sena_tipo === "ninguna" ? "" : Number(negocio.sena_valor))}
                className={tipo === "porcentaje" ? "pr-8" : "pl-7"}
              />
              <span
                className={cx(
                  "pointer-events-none absolute inset-y-0 grid place-items-center px-3 text-sm text-zinc-500",
                  tipo === "porcentaje" ? "right-0" : "left-0",
                )}
              >
                {tipo === "porcentaje" ? "%" : "$"}
              </span>
            </div>
          </Campo>
        ) : (
          <input type="hidden" name="sena_valor" value="0" />
        )}
        <Campo
          etiqueta="Plazo para pagar"
          htmlFor="pago_plazo_min"
          errores={estado.errores?.pago_plazo_min}
          ayuda="Después se libera el horario."
        >
          <Select id="pago_plazo_min" name="pago_plazo_min" defaultValue={valor("pago_plazo_min", negocio.pago_plazo_min)}>
            {[15, 30, 60, 120, 360, 1440].map((m) => (
              <option key={m} value={m}>
                {m < 60 ? `${m} minutos` : m === 1440 ? "24 horas" : `${m / 60} ${m === 60 ? "hora" : "horas"}`}
              </option>
            ))}
          </Select>
        </Campo>
      </div>
      {!conectado && tipo !== "ninguna" ? (
        <p className="text-sm text-amber-700">
          La seña se empieza a pedir cuando conectes Mercado Pago. Mientras tanto, las reservas se toman sin seña.
        </p>
      ) : null}
      <BotonEnviar>Guardar seña</BotonEnviar>
    </form>
  );
}

// --- WhatsApp ----------------------------------------------------------------------------

export function FormularioWhatsApp({ activo }: { activo: boolean }) {
  const { estado, accion, marcado, intento } = useFormulario(guardarWhatsApp);
  return (
    <form key={intento} action={accion} className="space-y-3">
      <MensajeAccion estado={estado} />
      <Casilla
        name="whatsapp_avisos"
        defaultChecked={marcado("whatsapp_avisos", activo)}
        etiqueta="Enviar confirmación y recordatorio por WhatsApp"
        descripcion="Se envían automáticamente desde el número de la plataforma, con el mismo horario que el recordatorio por mail."
      />
      <BotonEnviar tamano="sm">Guardar</BotonEnviar>
    </form>
  );
}
