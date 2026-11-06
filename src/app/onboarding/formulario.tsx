"use client";

import { useState } from "react";
import { BotonEnviar, MensajeAccion, useFormulario } from "@/components/formularios";
import { Campo, Casilla, Input, Select } from "@/components/ui";
import { RUBROS } from "@/lib/tipos";
import { crearNegocio } from "./acciones";

export function slugDesde(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 50);
}

/** El guion final se deja mientras se escribe y se quita al salir del campo. */
function slugFinal(texto: string) {
  return slugDesde(texto).replace(/-+$/, "");
}

export function FormularioOnboarding({ nombreUsuario, siteUrl }: { nombreUsuario: string; siteUrl: string }) {
  const { estado, accion, valor, marcado, intento } = useFormulario(crearNegocio);
  const [nombre, setNombre] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEditado, setSlugEditado] = useState(false);

  return (
    <form key={intento} action={accion} className="space-y-5" noValidate>
      <MensajeAccion estado={estado} />

      <Campo etiqueta="Nombre del negocio" htmlFor="nombre" errores={estado.errores?.nombre}>
        <Input
          id="nombre"
          name="nombre"
          required
          placeholder="Ej: Estudio Luna"
          value={nombre}
          onChange={(e) => {
            setNombre(e.target.value);
            if (!slugEditado) setSlug(slugDesde(e.target.value));
          }}
        />
      </Campo>

      <Campo
        etiqueta="Dirección de tu página de reservas"
        htmlFor="slug"
        errores={estado.errores?.slug}
        ayuda={
          <>
            Tus clientes reservan en{" "}
            <span className="font-medium text-zinc-700">
              {siteUrl.replace(/^https?:\/\//, "")}/n/{slug || "tu-negocio"}
            </span>
          </>
        }
      >
        <div className="flex items-center rounded-xl border border-zinc-200 bg-zinc-50 focus-within:border-marca-500 focus-within:ring-4 focus-within:ring-marca-100">
          <span className="pl-3.5 text-sm text-zinc-500">/n/</span>
          <input
            id="slug"
            name="slug"
            required
            className="w-full rounded-r-xl bg-white px-2 py-2.5 text-base outline-none sm:text-sm"
            value={slug}
            onChange={(e) => {
              setSlugEditado(true);
              setSlug(slugDesde(e.target.value));
            }}
            onBlur={() => setSlug(slugFinal(slug))}
          />
        </div>
      </Campo>

      <Campo etiqueta="Rubro" htmlFor="rubro" errores={estado.errores?.rubro}>
        <Select id="rubro" name="rubro" defaultValue={valor("rubro", "peluqueria_masculina")}>
          {Object.entries(RUBROS).map(([valor, texto]) => (
            <option key={valor} value={valor}>
              {texto}
            </option>
          ))}
        </Select>
      </Campo>

      <div className="grid gap-5 sm:grid-cols-2">
        <Campo etiqueta="Teléfono / WhatsApp" htmlFor="telefono" errores={estado.errores?.telefono} ayuda="Opcional">
          <Input id="telefono" name="telefono" type="tel" inputMode="tel" placeholder="341 555 1234" defaultValue={valor("telefono")} />
        </Campo>
        <Campo etiqueta="Dirección" htmlFor="direccion" errores={estado.errores?.direccion} ayuda="Opcional">
          <Input id="direccion" name="direccion" placeholder="Calle 123" defaultValue={valor("direccion")} />
        </Campo>
      </div>

      <Campo etiqueta="Tu nombre" htmlFor="nombre_dueno" errores={estado.errores?.nombre_dueno}>
        <Input id="nombre_dueno" name="nombre_dueno" defaultValue={valor("nombre_dueno", nombreUsuario)} required />
      </Campo>

      <Casilla
        name="dueno_atiende"
        defaultChecked={marcado("dueno_atiende", true)}
        etiqueta="Yo también atiendo clientes"
        descripcion="Te agregamos como profesional para que puedas recibir turnos. Lo podés cambiar después."
      />

      <BotonEnviar className="w-full" tamano="lg" pendiente="Creando tu negocio…">
        Crear mi negocio
      </BotonEnviar>
    </form>
  );
}
