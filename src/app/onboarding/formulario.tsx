"use client";

import { useActionState, useState } from "react";
import { BotonEnviar, MensajeAccion } from "@/components/formularios";
import { Campo, Casilla, Input, Select } from "@/components/ui";
import { RUBROS } from "@/lib/tipos";
import { crearNegocio } from "./acciones";

export function slugDesde(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

export function FormularioOnboarding({ nombreUsuario, siteUrl }: { nombreUsuario: string; siteUrl: string }) {
  const [estado, accion] = useActionState(crearNegocio, {});
  const [nombre, setNombre] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEditado, setSlugEditado] = useState(false);

  return (
    <form action={accion} className="space-y-5" noValidate>
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
          />
        </div>
      </Campo>

      <Campo etiqueta="Rubro" htmlFor="rubro" errores={estado.errores?.rubro}>
        <Select id="rubro" name="rubro" defaultValue="peluqueria">
          {Object.entries(RUBROS).map(([valor, texto]) => (
            <option key={valor} value={valor}>
              {texto}
            </option>
          ))}
        </Select>
      </Campo>

      <div className="grid gap-5 sm:grid-cols-2">
        <Campo etiqueta="Teléfono / WhatsApp" htmlFor="telefono" errores={estado.errores?.telefono} ayuda="Opcional">
          <Input id="telefono" name="telefono" type="tel" inputMode="tel" placeholder="341 555 1234" />
        </Campo>
        <Campo etiqueta="Dirección" htmlFor="direccion" errores={estado.errores?.direccion} ayuda="Opcional">
          <Input id="direccion" name="direccion" placeholder="Calle 123" />
        </Campo>
      </div>

      <Campo etiqueta="Tu nombre" htmlFor="nombre_dueno" errores={estado.errores?.nombre_dueno}>
        <Input id="nombre_dueno" name="nombre_dueno" defaultValue={nombreUsuario} required />
      </Campo>

      <Casilla
        name="dueno_atiende"
        defaultChecked
        etiqueta="Yo también atiendo clientes"
        descripcion="Te agregamos como profesional para que puedas recibir turnos. Lo podés cambiar después."
      />

      <BotonEnviar className="w-full" tamano="lg" pendiente="Creando tu negocio…">
        Crear mi negocio
      </BotonEnviar>
    </form>
  );
}
