import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Aviso, clasesBoton, EncabezadoPagina, Insignia, Tarjeta } from "@/components/ui";
import { requerirPanel } from "@/lib/auth";
import { integracionesDisponibles } from "@/lib/env";
import type { ConfigGoogle } from "@/lib/google";
import type { Integracion } from "@/lib/integraciones";
import type { ConfigMercadoPago } from "@/lib/mercadopago";
import { crearSupabaseServidor } from "@/lib/supabase/server";
import { AccionesCalendario, DesconectarMercadoPago, FormularioMercadoPago, FormularioSena, FormularioWhatsApp } from "./formularios";

export const metadata: Metadata = { title: "Integraciones" };

const MENSAJES_GOOGLE: Record<string, { tipo: "exito" | "error" | "alerta"; texto: string }> = {
  ok: { tipo: "exito", texto: "¡Listo! Google Calendar quedó conectado. Los turnos van a aparecer en unos segundos." },
  cancelado: { tipo: "alerta", texto: "Cancelaste la conexión con Google." },
  expirado: { tipo: "error", texto: "La conexión tardó demasiado. Probá de nuevo." },
  "sin-permiso": { tipo: "error", texto: "No tenés permiso para conectar ese calendario." },
  "no-configurado": { tipo: "error", texto: "Google Calendar no está configurado en el servidor." },
  error: { tipo: "error", texto: "No se pudo conectar con Google. Probá de nuevo." },
};

function fechaCorta(iso: string, tz: string) {
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short", timeZone: tz }).format(new Date(iso));
}

export default async function PaginaIntegraciones({ searchParams }: PageProps<"/panel/integraciones">) {
  const { negocio, perfil, esDueno } = await requerirPanel();
  const { google: resultadoGoogle } = await searchParams;
  const disponibles = integracionesDisponibles();
  const supabase = await crearSupabaseServidor();

  let consultaProfs = supabase.from("profesionales").select("id, nombre, color").eq("activo", true).order("orden").order("nombre");
  if (!esDueno) consultaProfs = consultaProfs.eq("id", perfil.profesional_id ?? "00000000-0000-0000-0000-000000000000");
  const [{ data: profs }, { data: filas }] = await Promise.all([
    consultaProfs,
    // RLS: el dueño ve todas; un empleado, solo su Google Calendar.
    supabase.from("integraciones").select("*"),
  ]);
  const integraciones = (filas ?? []) as Integracion[];
  const googlePorProf = new Map(
    integraciones
      .filter((i) => i.proveedor === "google_calendar")
      .map((i) => [i.profesional_id, i as Integracion<ConfigGoogle>]),
  );
  const mp = integraciones.find((i) => i.proveedor === "mercadopago") as Integracion<ConfigMercadoPago> | undefined;
  const aviso = typeof resultadoGoogle === "string" ? MENSAJES_GOOGLE[resultadoGoogle] : undefined;
  const tz = negocio.zona_horaria;

  return (
    <div className="max-w-3xl space-y-6">
      <EncabezadoPagina
        titulo="Integraciones"
        descripcion={esDueno ? "Conectá tu agenda con Google Calendar, cobrá señas y avisá por WhatsApp." : "Conectá tu agenda con Google Calendar."}
      />
      {aviso ? <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso> : null}

      {/* Google Calendar ------------------------------------------------------------ */}
      <Seccion
        icono={<IconoGoogle />}
        titulo="Google Calendar"
        descripcion="Cada turno aparece en el calendario del profesional y se actualiza solo si se mueve o se cancela."
      >
        {!disponibles.google ? (
          <NoConfigurado variables="GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e INTEGRACIONES_CLAVE" />
        ) : !profs?.length ? (
          <p className="text-sm text-zinc-600">
            {esDueno ? "Todavía no hay profesionales activos." : "Tu usuario no tiene una agenda asignada."}
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200">
            {profs.map((p) => {
              const g = googlePorProf.get(p.id);
              const propio = p.id === perfil.profesional_id;
              return (
                <li key={p.id} className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: p.color }} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">
                        {p.nombre} {propio ? <span className="font-normal text-zinc-500">(vos)</span> : null}
                      </p>
                      {g ? (
                        <p className="truncate text-sm text-zinc-500">
                          {g.config.email}
                          {g.config.ultima_sync ? ` · sincronizado ${fechaCorta(g.config.ultima_sync, tz)}` : ""}
                        </p>
                      ) : null}
                    </div>
                    {g?.estado === "activa" ? (
                      <Insignia color="verde">Conectado</Insignia>
                    ) : g?.estado === "error" ? (
                      <Insignia color="rojo">Reconectar</Insignia>
                    ) : (
                      <a href={`/api/google/conectar?profesional=${p.id}`} className={clasesBoton("secundario", "sm")}>
                        Conectar
                      </a>
                    )}
                  </div>
                  {g?.config.ultimo_error ? <Aviso tipo="alerta">{g.config.ultimo_error}</Aviso> : null}
                  {g?.estado === "error" ? (
                    <a href={`/api/google/conectar?profesional=${p.id}`} className={clasesBoton("primario", "sm")}>
                      Volver a conectar
                    </a>
                  ) : null}
                  {g ? <AccionesCalendario profesionalId={p.id} importarOcupado={g.config.importar_ocupado} /> : null}
                </li>
              );
            })}
          </ul>
        )}
        {esDueno && disponibles.google ? (
          <p className="mt-3 text-xs text-zinc-500">
            Cada persona conviene que conecte su propio calendario desde su usuario. Vos podés conectar el de cualquier
            profesional si tenés acceso a esa cuenta de Google.
          </p>
        ) : null}
      </Seccion>

      {esDueno ? (
        <>
          {/* Mercado Pago --------------------------------------------------------------- */}
          <Seccion
            icono={<IconoMercadoPago />}
            titulo="Seña con Mercado Pago"
            descripcion="Pedí una seña al reservar online para reducir los faltazos. El dinero va directo a tu cuenta."
          >
            {!disponibles.mercadopago ? (
              <NoConfigurado variables="INTEGRACIONES_CLAVE y SUPABASE_SERVICE_ROLE_KEY" />
            ) : mp ? (
              <div className="space-y-6">
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{mp.config.nickname}</p>
                    <p className="truncate text-sm text-zinc-500">{mp.config.email ?? `Cuenta ${mp.config.usuario_id}`}</p>
                  </div>
                  {mp.config.modo === "prueba" ? <Insignia color="ambar">Modo prueba</Insignia> : <Insignia color="verde">Conectado</Insignia>}
                  <DesconectarMercadoPago />
                </div>
                <FormularioSena negocio={negocio} conectado />
              </div>
            ) : (
              <div className="space-y-6">
                <FormularioMercadoPago />
                <div className="border-t border-zinc-100 pt-5">
                  <FormularioSena negocio={negocio} conectado={false} />
                </div>
              </div>
            )}
          </Seccion>

          {/* WhatsApp ------------------------------------------------------------------- */}
          <Seccion
            icono={<IconoWhatsApp />}
            titulo="WhatsApp"
            descripcion="Desde cada turno podés escribirle al cliente con un mensaje listo (confirmación, recordatorio o cambio). Además, si la plataforma lo tiene activado, los avisos se mandan solos."
          >
            {disponibles.whatsapp ? (
              <FormularioWhatsApp activo={negocio.whatsapp_avisos} />
            ) : (
              <p className="text-sm text-zinc-600">
                Los avisos automáticos por WhatsApp no están activados en este servidor (requieren una cuenta de WhatsApp
                Business API). Los mensajes manuales desde cada turno funcionan igual.
              </p>
            )}
          </Seccion>
        </>
      ) : null}
    </div>
  );
}

function Seccion({ icono, titulo, descripcion, children }: { icono: ReactNode; titulo: string; descripcion: string; children: ReactNode }) {
  return (
    <Tarjeta>
      <div className="mb-5 flex gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-zinc-200 bg-white">{icono}</span>
        <div>
          <h2 className="text-lg font-bold">{titulo}</h2>
          <p className="text-sm text-zinc-600">{descripcion}</p>
        </div>
      </div>
      {children}
    </Tarjeta>
  );
}

function NoConfigurado({ variables }: { variables: string }) {
  return (
    <Aviso tipo="alerta">
      No está disponible en este servidor. Para activarlo hay que configurar {variables} (ver README).
    </Aviso>
  );
}

function IconoGoogle() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
      <rect x="3" y="4" width="18" height="17" rx="3" fill="#fff" stroke="#4285F4" strokeWidth="2" />
      <path d="M3 9h18" stroke="#4285F4" strokeWidth="2" />
      <path d="M8 2v4M16 2v4" stroke="#EA4335" strokeWidth="2" strokeLinecap="round" />
      <text x="12" y="18.5" textAnchor="middle" fontSize="8" fontWeight="700" fill="#34A853" fontFamily="Arial">
        31
      </text>
    </svg>
  );
}

function IconoMercadoPago() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
      <ellipse cx="12" cy="12" rx="10" ry="7" fill="#00B1EA" />
      <path d="M6.5 12.5c1.6-1.6 3.2-2.4 5.5-.8 2.3 1.6 3.9.8 5.5-.8" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function IconoWhatsApp() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
      <path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3z" fill="#25D366" />
      <path
        d="M9 8c.3-.4.6-.4.9-.4.3 0 .5.1.6.4l.7 1.6c.1.3 0 .5-.2.7l-.4.5c.5 1 1.3 1.8 2.3 2.3l.5-.4c.2-.2.5-.3.7-.2l1.6.7c.3.1.4.4.4.6 0 .3-.1.7-.4.9-.6.6-1.5.8-2.3.5a8.4 8.4 0 0 1-4.6-4.6c-.3-.8-.1-1.8.5-2.3z"
        fill="#fff"
      />
    </svg>
  );
}
