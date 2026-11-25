"use client";

import Link from "next/link";
import { useState } from "react";
import { BotonEnviar, MensajeAccion, useFormulario } from "@/components/formularios";
import { Campo, Casilla, Input, Tarjeta } from "@/components/ui";
import { MEDIOS_PEDIDO, type MedioPago, type Negocio } from "@/lib/tipos";
import { guardarTienda } from "./acciones";

const AYUDA_MEDIO: Record<MedioPago, string> = {
  mercadopago: "Paga al pedir; si no termina en 30 minutos, el pedido se libera.",
  transferencia: "Te transfiere al alias o CBU y vos marcás el pedido como pagado.",
  efectivo: "Paga cuando lo retira en el local.",
};

export function TiendaNegocio({
  negocio,
  mpOfrecido,
  mpConectado,
}: {
  negocio: Negocio;
  /** El servidor permite conectar Mercado Pago (hay clave de cifrado). */
  mpOfrecido: boolean;
  /** La integración de Mercado Pago está activa. */
  mpConectado: boolean;
}) {
  const { estado, accion, valor, marcado, intento } = useFormulario(guardarTienda);
  const e = estado.errores ?? {};
  // Varias casillas con el mismo nombre: se llevan acá para no perderlas si falla el envío.
  const [medios, setMedios] = useState<MedioPago[]>(() =>
    negocio.tienda_medios.filter((m) => m !== "mercadopago" || mpConectado),
  );
  const opciones: MedioPago[] = mpOfrecido ? ["efectivo", "transferencia", "mercadopago"] : ["efectivo", "transferencia"];
  const conTransferencia = medios.includes("transferencia");

  function alternar(m: MedioPago, si: boolean) {
    setMedios((actual) => (si ? [...actual.filter((x) => x !== m), m] : actual.filter((x) => x !== m)));
  }

  return (
    <form key={intento} action={accion} noValidate>
      <Tarjeta id="tienda" className="scroll-mt-20 space-y-5">
        <div>
          <h2 className="text-lg font-bold">Tienda</h2>
          <p className="text-sm text-zinc-600">
            Tus clientes piden productos desde tu página y los retiran en el local. Los productos se cargan en{" "}
            <Link href="/panel/productos" className="font-medium text-marca-700 hover:underline">
              Productos
            </Link>
            .
          </p>
        </div>
        <MensajeAccion estado={estado} />
        <Casilla
          name="tienda_activa"
          defaultChecked={marcado("tienda_activa", negocio.tienda_activa)}
          etiqueta="Mostrar la tienda en mi página"
          descripcion="Si la apagás, nadie puede hacer pedidos nuevos. Los pedidos hechos siguen en Pedidos."
        />

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-tinta">¿Cómo te pueden pagar?</legend>
          <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200">
            {opciones.map((m) => {
              const bloqueado = m === "mercadopago" && !mpConectado;
              return (
                <li key={m} className="px-3 py-2.5">
                  <label className={bloqueado ? "flex items-start gap-2.5 opacity-60" : "flex cursor-pointer items-start gap-2.5"}>
                    <input
                      type="checkbox"
                      name="tienda_medios"
                      value={m}
                      checked={!bloqueado && medios.includes(m)}
                      disabled={bloqueado}
                      onChange={(ev) => alternar(m, ev.target.checked)}
                      className="mt-0.5 size-5 shrink-0 rounded-md border-zinc-300 accent-marca-700"
                    />
                    <span>
                      <span className="block text-sm font-medium text-tinta">{MEDIOS_PEDIDO[m]}</span>
                      <span className="block text-xs text-zinc-500">{AYUDA_MEDIO[m]}</span>
                    </span>
                  </label>
                  {bloqueado ? (
                    <Link href="/panel/integraciones" className="mt-1 ml-7.5 inline-block text-xs font-semibold text-marca-700 hover:underline">
                      Conectalo en Integraciones
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {e.tienda_medios?.[0] ? <p className="text-xs text-red-600">{e.tienda_medios[0]}</p> : null}
        </fieldset>

        {conTransferencia ? (
          <div className="space-y-5 rounded-2xl bg-zinc-50 p-4">
            <p className="text-sm font-medium text-tinta">Datos para la transferencia</p>
            <div className="grid gap-5 sm:grid-cols-2">
              <Campo etiqueta="Alias" htmlFor="transferencia_alias" errores={e.transferencia_alias}>
                <Input
                  id="transferencia_alias"
                  name="transferencia_alias"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="mi.negocio.mp"
                  defaultValue={valor("transferencia_alias", negocio.transferencia_alias)}
                />
              </Campo>
              <Campo etiqueta="CBU o CVU" htmlFor="transferencia_cbu" errores={e.transferencia_cbu} ayuda="Opcional si pusiste el alias.">
                <Input
                  id="transferencia_cbu"
                  name="transferencia_cbu"
                  inputMode="numeric"
                  defaultValue={valor("transferencia_cbu", negocio.transferencia_cbu)}
                />
              </Campo>
            </div>
            <Campo
              etiqueta="Titular de la cuenta"
              htmlFor="transferencia_titular"
              errores={e.transferencia_titular}
              ayuda="Opcional. Así el cliente comprueba que transfiere a la cuenta correcta."
            >
              <Input
                id="transferencia_titular"
                name="transferencia_titular"
                defaultValue={valor("transferencia_titular", negocio.transferencia_titular)}
              />
            </Campo>
            <Campo
              etiqueta="Plazo para transferir (horas)"
              htmlFor="transferencia_plazo_horas"
              errores={e.transferencia_plazo_horas}
              ayuda="Entre 1 y 168. Si no se marca como pagado a tiempo, el pedido vence y el stock vuelve."
            >
              <Input
                id="transferencia_plazo_horas"
                name="transferencia_plazo_horas"
                type="number"
                inputMode="numeric"
                min={1}
                max={168}
                defaultValue={valor("transferencia_plazo_horas", negocio.transferencia_plazo_horas)}
                className="max-w-32"
              />
            </Campo>
          </div>
        ) : (
          <>
            {/* Sin transferencia, lo guardado queda como estaba. */}
            <input type="hidden" name="transferencia_alias" value={negocio.transferencia_alias ?? ""} />
            <input type="hidden" name="transferencia_cbu" value={negocio.transferencia_cbu ?? ""} />
            <input type="hidden" name="transferencia_titular" value={negocio.transferencia_titular ?? ""} />
            <input type="hidden" name="transferencia_plazo_horas" value={negocio.transferencia_plazo_horas} />
          </>
        )}

        {medios.includes("efectivo") ? (
          <Campo
            etiqueta="Plazo para retirar y pagar en efectivo (días)"
            htmlFor="efectivo_plazo_dias"
            errores={e.efectivo_plazo_dias}
            ayuda="Entre 1 y 14. Si el pedido va con un turno, se guarda hasta el día del turno."
          >
            <Input
              id="efectivo_plazo_dias"
              name="efectivo_plazo_dias"
              type="number"
              inputMode="numeric"
              min={1}
              max={14}
              defaultValue={valor("efectivo_plazo_dias", negocio.efectivo_plazo_dias)}
              className="max-w-32"
            />
          </Campo>
        ) : (
          <input type="hidden" name="efectivo_plazo_dias" value={negocio.efectivo_plazo_dias} />
        )}

        <BotonEnviar className="w-full sm:w-auto">Guardar tienda</BotonEnviar>
      </Tarjeta>
    </form>
  );
}
