"use client";

import Link from "next/link";
import { BotonEnviar, MensajeAccion, useFormulario } from "@/components/formularios";
import { Campo, Input } from "@/components/ui";
import type { EstadoAccion } from "@/lib/tipos";
import { iniciarSesion, pedirRecuperacion, registrarse, restablecerPassword, verificarCodigo } from "./acciones";

export function FormularioLogin({ next }: { next?: string }) {
  const { estado, accion, valor, intento } = useFormulario(iniciarSesion);
  return (
    <form key={intento} action={accion} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next ?? ""} />
      <MensajeAccion estado={estado} />
      <Campo etiqueta="Email" htmlFor="email" errores={estado.errores?.email}>
        <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" defaultValue={valor("email")} required />
      </Campo>
      <Campo etiqueta="Contraseña" htmlFor="password" errores={estado.errores?.password}>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Campo>
      <BotonEnviar className="w-full" tamano="lg" pendiente="Ingresando…">
        Ingresar
      </BotonEnviar>
      <p className="text-center text-sm">
        <Link href="/recuperar" className="font-medium text-marca-700 hover:underline">
          Olvidé mi contraseña
        </Link>
      </p>
    </form>
  );
}

export function FormularioRegistro() {
  const { estado, accion, valor, intento } = useFormulario(registrarse);
  if (estado.ok) return <MensajeAccion estado={estado} />;
  return (
    <form key={intento} action={accion} className="space-y-4" noValidate>
      <MensajeAccion estado={estado} />
      <Campo etiqueta="Tu nombre" htmlFor="nombre" errores={estado.errores?.nombre}>
        <Input id="nombre" name="nombre" autoComplete="name" defaultValue={valor("nombre")} required />
      </Campo>
      <Campo etiqueta="Email" htmlFor="email" errores={estado.errores?.email}>
        <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" defaultValue={valor("email")} required />
      </Campo>
      <Campo
        etiqueta="Contraseña"
        htmlFor="password"
        errores={estado.errores?.password}
        ayuda="Mínimo 8 caracteres."
      >
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
      </Campo>
      <BotonEnviar className="w-full" tamano="lg" pendiente="Creando cuenta…">
        Crear cuenta gratis
      </BotonEnviar>
    </form>
  );
}

/**
 * Elegir contraseña con un link: el de recuperación que llega por mail
 * (Better Auth) o el de acceso que el dueño le pasa a un empleado.
 */
export function FormularioPassword({
  token,
  accion: accionServidor = restablecerPassword,
}: {
  token: string;
  accion?: (prev: EstadoAccion, formData: FormData) => Promise<EstadoAccion>;
}) {
  const { estado, accion } = useFormulario(accionServidor);
  return (
    <form action={accion} className="space-y-4" noValidate>
      <input type="hidden" name="token" value={token} />
      <MensajeAccion estado={estado} />
      <Campo etiqueta="Contraseña nueva" htmlFor="password" errores={estado.errores?.password} ayuda="Mínimo 8 caracteres.">
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
      </Campo>
      <Campo etiqueta="Repetila" htmlFor="confirmacion" errores={estado.errores?.confirmacion}>
        <Input id="confirmacion" name="confirmacion" type="password" autoComplete="new-password" required />
      </Campo>
      <BotonEnviar className="w-full" tamano="lg">
        Guardar contraseña
      </BotonEnviar>
    </form>
  );
}

export function FormularioRecuperar() {
  const { estado, accion } = useFormulario(pedirRecuperacion);
  if (estado.ok) return <MensajeAccion estado={estado} />;
  return (
    <form action={accion} className="space-y-4" noValidate>
      <MensajeAccion estado={estado} />
      <Campo etiqueta="Email de tu cuenta" htmlFor="email" errores={estado.errores?.email}>
        <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required />
      </Campo>
      <BotonEnviar className="w-full" tamano="lg" pendiente="Enviando…">
        Enviarme el link
      </BotonEnviar>
    </form>
  );
}

export function FormularioCodigo({ next }: { next?: string }) {
  const { estado, accion } = useFormulario(verificarCodigo);
  return (
    <form action={accion} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next ?? ""} />
      <MensajeAccion estado={estado} />
      <Campo
        etiqueta="Código"
        htmlFor="codigo"
        errores={estado.errores?.codigo}
        ayuda="Los 6 números de tu app autenticadora. Si no la tenés a mano, usá uno de tus códigos de respaldo."
      >
        <Input id="codigo" name="codigo" autoComplete="one-time-code" inputMode="numeric" autoFocus required />
      </Campo>
      <BotonEnviar className="w-full" tamano="lg" pendiente="Verificando…">
        Verificar
      </BotonEnviar>
    </form>
  );
}
