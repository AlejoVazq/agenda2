import { timingSafeEqual } from "node:crypto";
import { after, NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { canjearCodigoGoogle, importarOcupados, sincronizarPendientes, type ConfigGoogle } from "@/lib/google";
import { buscarIntegracion, guardarIntegracion } from "@/lib/integraciones";
import { sesionConPermisoSobreProfesional } from "@/lib/permisos";

function iguales(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const volver = new URL("/panel/integraciones", env.siteUrl);
  const terminar = (resultado: string) => {
    volver.searchParams.set("google", resultado);
    const r = NextResponse.redirect(volver);
    r.cookies.delete({ name: "google_oauth", path: "/api/google" });
    return r;
  };

  const [stateCookie, profesionalId] = (request.cookies.get("google_oauth")?.value ?? "").split(".");
  const state = sp.get("state") ?? "";
  if (!stateCookie || !profesionalId || !iguales(stateCookie, state)) return terminar("expirado");
  if (sp.get("error")) return terminar("cancelado");
  const codigo = sp.get("code");
  if (!codigo) return terminar("error");

  // Se vuelve a verificar el permiso: la cookie sola no alcanza.
  const sesion = await sesionConPermisoSobreProfesional(profesionalId);
  if (!sesion) return terminar("sin-permiso");

  try {
    const { refreshToken, email } = await canjearCodigoGoogle(codigo);
    const anterior = await buscarIntegracion<ConfigGoogle>(sesion.negocio.id, "google_calendar", profesionalId);
    await guardarIntegracion<ConfigGoogle, { refresh_token: string }>({
      negocioId: sesion.negocio.id,
      proveedor: "google_calendar",
      profesionalId,
      config: {
        email,
        calendario: "primary",
        importar_ocupado: anterior?.config.importar_ocupado ?? true,
        ultima_sync: null,
        ultimo_error: null,
      },
      secreto: { refresh_token: refreshToken },
    });

    // Primera sincronización en segundo plano: turnos futuros y horarios ocupados.
    after(async () => {
      const integracion = await buscarIntegracion<ConfigGoogle>(sesion.negocio.id, "google_calendar", profesionalId);
      if (integracion) await importarOcupados(integracion).catch((e) => console.error("[google] primera importación", e));
      await sincronizarPendientes(100).catch((e) => console.error("[google] primera sincronización", e));
    });
    return terminar("ok");
  } catch (e) {
    console.error("[google] callback", e);
    return terminar("error");
  }
}
