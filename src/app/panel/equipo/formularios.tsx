"use client";

import { useState, useTransition } from "react";
import { BotonEnviar, MensajeAccion, useFormulario } from "@/components/formularios";
import { BotonCopiar } from "@/components/copiar";
import { Aviso, Boton, Campo, Input, Select } from "@/components/ui";
import type { Profesional } from "@/lib/tipos";
import { invitarEmpleado, quitarAcceso, regenerarLink, type EstadoInvitacion } from "./acciones";

function LinkGenerado({ estado }: { estado: EstadoInvitacion }) {
  if (!estado.link) return <MensajeAccion estado={estado} />;
  return (
    <Aviso tipo="exito" className="space-y-2">
      <p>{estado.mensaje}</p>
      <p className="break-all rounded-lg bg-white/70 px-2 py-1.5 font-mono text-xs">{estado.link}</p>
      <div className="flex flex-wrap gap-2">
        <BotonCopiar texto={estado.link} />
        <a
          className="inline-flex h-9 items-center rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700"
          href={`https://wa.me/?text=${encodeURIComponent(`Te invito a la agenda del negocio. Entrá acá para crear tu contraseña: ${estado.link}`)}`}
          target="_blank"
        >
          Enviar por WhatsApp
        </a>
      </div>
      <p className="text-xs opacity-80">El link es personal y vence en 24 horas.</p>
    </Aviso>
  );
}

export function FormularioInvitacion({ profesionales }: { profesionales: Pick<Profesional, "id" | "nombre">[] }) {
  const { estado, accion, valor, intento } = useFormulario(invitarEmpleado);
  const e = estado.errores ?? {};
  // El link queda fuera del formulario: al invitar al último profesional libre la página se
  // recarga sin campos para cargar, pero este componente sigue montado y el link se ve igual.
  return (
    <div className="space-y-4">
      <LinkGenerado estado={estado} />
      {profesionales.length === 0 ? (
        <Aviso tipo="info">Todos los profesionales activos ya tienen usuario. Creá uno nuevo en Profesionales.</Aviso>
      ) : (
        <form key={intento} action={accion} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Nombre" htmlFor="inv-nombre" errores={e.nombre}>
              <Input id="inv-nombre" name="nombre" defaultValue={valor("nombre")} required />
            </Campo>
            <Campo etiqueta="Email" htmlFor="inv-email" errores={e.email}>
              <Input id="inv-email" name="email" type="email" inputMode="email" defaultValue={valor("email")} required />
            </Campo>
          </div>
          <Campo
            etiqueta="Agenda que va a manejar"
            htmlFor="inv-prof"
            errores={e.profesional_id}
            ayuda="Va a ver y gestionar solo los turnos de este profesional."
          >
            <Select id="inv-prof" name="profesional_id" required>
              {profesionales.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </Select>
          </Campo>
          <BotonEnviar pendiente="Generando…">Generar invitación</BotonEnviar>
        </form>
      )}
    </div>
  );
}

export function AccionesEmpleado({ perfilId }: { perfilId: string }) {
  const [estado, setEstado] = useState<EstadoInvitacion>();
  const [confirmar, setConfirmar] = useState(false);
  const [pendiente, iniciar] = useTransition();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Boton
          variante="secundario"
          tamano="sm"
          disabled={pendiente}
          onClick={() => iniciar(async () => setEstado(await regenerarLink(perfilId)))}
        >
          Nuevo link de acceso
        </Boton>
        {confirmar ? (
          <>
            <Boton
              variante="peligro"
              tamano="sm"
              disabled={pendiente}
              onClick={() => iniciar(async () => setEstado(await quitarAcceso(perfilId)))}
            >
              Confirmar
            </Boton>
            <Boton variante="fantasma" tamano="sm" onClick={() => setConfirmar(false)}>
              Cancelar
            </Boton>
          </>
        ) : (
          <Boton variante="fantasma" tamano="sm" className="text-red-600" onClick={() => setConfirmar(true)}>
            Quitar acceso
          </Boton>
        )}
      </div>
      {estado ? <LinkGenerado estado={estado} /> : null}
    </div>
  );
}
