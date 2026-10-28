"use client";

import { BotonEnviar, MensajeAccion, useFormulario } from "@/components/formularios";
import { Campo, Casilla, Input, Select, Tarjeta, Textarea } from "@/components/ui";
import { RUBROS, type Negocio } from "@/lib/tipos";
import { guardarNegocio } from "./acciones";

export function FormularioNegocio({ negocio, siteUrl }: { negocio: Negocio; siteUrl: string }) {
  const { estado, accion, valor, marcado, intento } = useFormulario(guardarNegocio);
  const e = estado.errores ?? {};

  return (
    <form key={intento} action={accion} className="space-y-6" noValidate>
      <MensajeAccion estado={estado} />

      <Tarjeta className="space-y-5">
        <h2 className="text-lg font-bold">Datos del negocio</h2>
        <Campo etiqueta="Nombre" htmlFor="nombre" errores={e.nombre}>
          <Input id="nombre" name="nombre" defaultValue={valor("nombre", negocio.nombre)} required />
        </Campo>
        <Campo
          etiqueta="Dirección de tu página"
          htmlFor="slug"
          errores={e.slug}
          ayuda={`${siteUrl.replace(/^https?:\/\//, "")}/n/… — si la cambiás, el link anterior deja de funcionar.`}
        >
          <Input id="slug" name="slug" defaultValue={valor("slug", negocio.slug)} required />
        </Campo>
        <Campo etiqueta="Rubro" htmlFor="rubro" errores={e.rubro}>
          <Select id="rubro" name="rubro" defaultValue={valor("rubro", negocio.rubro)}>
            {Object.entries(RUBROS).map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </Select>
        </Campo>
        <div className="grid gap-5 sm:grid-cols-2">
          <Campo etiqueta="Teléfono / WhatsApp" htmlFor="telefono" errores={e.telefono}>
            <Input id="telefono" name="telefono" type="tel" defaultValue={valor("telefono", negocio.telefono)} />
          </Campo>
          <Campo etiqueta="Dirección" htmlFor="direccion" errores={e.direccion}>
            <Input id="direccion" name="direccion" defaultValue={valor("direccion", negocio.direccion)} />
          </Campo>
        </div>
        <Campo etiqueta="Descripción" htmlFor="descripcion" errores={e.descripcion} ayuda="Se muestra en tu página de reservas.">
          <Textarea id="descripcion" name="descripcion" rows={3} defaultValue={valor("descripcion", negocio.descripcion)} />
        </Campo>
      </Tarjeta>

      <Tarjeta className="space-y-5">
        <div>
          <h2 className="text-lg font-bold">Reservas y cancelaciones</h2>
          <p className="text-sm text-zinc-600">Reglas que se aplican a las reservas online.</p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Campo
            etiqueta="Cancelación online hasta"
            htmlFor="cancelacion_min_horas"
            errores={e.cancelacion_min_horas}
            ayuda="Horas antes del turno. Después, el cliente tiene que comunicarse con vos."
          >
            <Select id="cancelacion_min_horas" name="cancelacion_min_horas" defaultValue={valor("cancelacion_min_horas", negocio.cancelacion_min_horas)}>
              {[0, 1, 2, 3, 4, 6, 12, 24, 48, 72].map((h) => (
                <option key={h} value={h}>
                  {h === 0 ? "Hasta el momento del turno" : `${h} ${h === 1 ? "hora" : "horas"} antes`}
                </option>
              ))}
            </Select>
          </Campo>
          <Campo
            etiqueta="Anticipación mínima para reservar"
            htmlFor="anticipacion_min_min"
            errores={e.anticipacion_min_min}
          >
            <Select id="anticipacion_min_min" name="anticipacion_min_min" defaultValue={valor("anticipacion_min_min", negocio.anticipacion_min_min)}>
              {[0, 30, 60, 120, 180, 360, 720, 1440].map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? "Sin mínimo" : m < 60 ? `${m} minutos` : `${m / 60} ${m === 60 ? "hora" : "horas"}`}
                </option>
              ))}
            </Select>
          </Campo>
          <Campo
            etiqueta="Se puede reservar hasta"
            htmlFor="anticipacion_max_dias"
            errores={e.anticipacion_max_dias}
          >
            <Select id="anticipacion_max_dias" name="anticipacion_max_dias" defaultValue={valor("anticipacion_max_dias", negocio.anticipacion_max_dias)}>
              {[7, 14, 21, 30, 45, 60, 90].map((d) => (
                <option key={d} value={d}>
                  {d} días adelante
                </option>
              ))}
            </Select>
          </Campo>
          <Campo
            etiqueta="Mostrar horarios cada"
            htmlFor="intervalo_min"
            errores={e.intervalo_min}
            ayuda="Separación entre los horarios ofrecidos."
          >
            <Select id="intervalo_min" name="intervalo_min" defaultValue={valor("intervalo_min", negocio.intervalo_min)}>
              {[5, 10, 15, 20, 30, 60].map((m) => (
                <option key={m} value={m}>
                  {m} minutos
                </option>
              ))}
            </Select>
          </Campo>
        </div>
        <Casilla
          name="confirmacion_automatica"
          defaultChecked={marcado("confirmacion_automatica", negocio.confirmacion_automatica)}
          etiqueta="Confirmar automáticamente las reservas online"
          descripcion="Si lo desactivás, las reservas quedan como pendientes hasta que las confirmes."
        />
      </Tarjeta>

      <BotonEnviar tamano="lg" className="w-full sm:w-auto">
        Guardar cambios
      </BotonEnviar>
    </form>
  );
}
