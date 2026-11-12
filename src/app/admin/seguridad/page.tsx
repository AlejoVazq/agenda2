import { Aviso, EncabezadoPagina, Tarjeta } from "@/components/ui";
import { requerirAdmin } from "@/lib/admin";
import { ActivarDosFactores } from "./formulario";

export default async function PaginaSeguridad() {
  const admin = await requerirAdmin({ sinDosFactores: true });

  return (
    <div className="max-w-2xl">
      <EncabezadoPagina titulo="Seguridad" descripcion={`Cuenta de administrador: ${admin.email}`} />
      <Tarjeta className="space-y-4">
        <h2 className="text-lg font-bold">Segundo factor</h2>
        {admin.dosFactores ? (
          <>
            <Aviso tipo="exito">Activado. Cada vez que ingreses te vamos a pedir el código de tu app autenticadora.</Aviso>
            <p className="text-sm text-zinc-600">
              Si perdés el celular, entrá con uno de tus códigos de respaldo. Si tampoco los tenés, desde el servidor:{" "}
              <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs">npm run admin -- quitar-2fa {admin.email}</code> y
              volvé a configurarlo.
            </p>
          </>
        ) : (
          <>
            <Aviso tipo="info">
              Esta cuenta puede ver y modificar todos los negocios, así que además de la contraseña pide un código de una
              app autenticadora. Configuralo para entrar al panel.
            </Aviso>
            <ActivarDosFactores />
          </>
        )}
      </Tarjeta>
    </div>
  );
}
