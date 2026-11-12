"use client";

import { BotonEnviar, MensajeAccion, useFormulario } from "@/components/formularios";
import { BotonCopiar } from "@/components/copiar";
import { Aviso, Campo, Input } from "@/components/ui";
import { activarDosFactores, confirmarDosFactores } from "../acciones";

// Dos pasos: contraseña → QR + códigos de respaldo → primer código de la app.
export function ActivarDosFactores() {
  const paso1 = useFormulario(activarDosFactores);
  const paso2 = useFormulario(confirmarDosFactores);

  if (!paso1.estado.qr) {
    return (
      <form action={paso1.accion} className="space-y-4" noValidate>
        <MensajeAccion estado={paso1.estado} />
        <Campo etiqueta="Tu contraseña" htmlFor="password" errores={paso1.estado.errores?.password}>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Campo>
        <BotonEnviar pendiente="Generando…">Empezar</BotonEnviar>
      </form>
    );
  }

  const codigos = paso1.estado.codigosRespaldo ?? [];
  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-sm font-semibold">1. Escaneá este código con tu app autenticadora</p>
        <p className="mb-3 text-sm text-zinc-600">
          Google Authenticator, Microsoft Authenticator, 1Password, Bitwarden… cualquiera sirve.
        </p>
        {/* eslint-disable-next-line @next/next/no-img-element -- data URL generada en el servidor */}
        <img src={paso1.estado.qr} alt="Código QR para la app autenticadora" width={220} height={220} className="rounded-lg border border-zinc-200" />
        {paso1.estado.secreto ? (
          <p className="mt-2 text-xs text-zinc-500">
            ¿No podés escanear? Cargá esta clave a mano: <span className="break-all font-mono">{paso1.estado.secreto}</span>
          </p>
        ) : null}
      </div>

      <Aviso tipo="alerta" className="space-y-2">
        <p className="font-semibold">2. Guardá estos códigos de respaldo en un lugar seguro</p>
        <p className="text-sm">
          Si perdés el celular, cada código sirve una vez para entrar. No se vuelven a mostrar.
        </p>
        <p className="grid grid-cols-2 gap-x-4 font-mono text-sm sm:grid-cols-5">
          {codigos.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </p>
        <BotonCopiar texto={codigos.join("\n")} etiqueta="Copiar códigos" />
      </Aviso>

      <form action={paso2.accion} className="space-y-4" noValidate>
        <p className="text-sm font-semibold">3. Ingresá el código que muestra la app</p>
        <MensajeAccion estado={paso2.estado} />
        <Campo etiqueta="Código" htmlFor="codigo" errores={paso2.estado.errores?.codigo}>
          <Input id="codigo" name="codigo" inputMode="numeric" autoComplete="one-time-code" className="max-w-40" required />
        </Campo>
        <BotonEnviar pendiente="Verificando…">Activar</BotonEnviar>
      </form>
    </div>
  );
}
