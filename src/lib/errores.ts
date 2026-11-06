// Traduce errores de Postgres/Supabase a mensajes para el usuario.
const MENSAJES: Record<string, string> = {
  YA_TIENE_NEGOCIO: "Tu usuario ya tiene un negocio asociado.",
  SLUG_OCUPADO: "Esa dirección ya está en uso. Probá con otra.",
  SIN_PERMISO: "No tenés permiso para hacer eso.",
  NO_AUTENTICADO: "Tenés que iniciar sesión.",
  DATOS_INVALIDOS: "Revisá los datos ingresados.",
  NEGOCIO_NO_DISPONIBLE: "Este negocio no está tomando reservas en este momento.",
  HORARIO_NO_DISPONIBLE: "Ese horario ya no está disponible. Elegí otro, por favor.",
  LIMITE_TURNOS:
    "Ya tenés 3 turnos reservados en este negocio. Para sacar otro, comunicate con el negocio.",
  LIMITE_DIARIO:
    "Ya tenés un turno ese día con este email. Elegí otra fecha o comunicate con el negocio.",
  LIMITE_AUSENCIAS:
    "Como no asististe a varios turnos, solo podés tener un turno reservado a la vez. Para sacar otro, comunicate con el negocio.",
  TURNO_FUTURO: "Ese turno todavía no empezó.",
  TURNO_NO_ENCONTRADO: "No encontramos el turno.",
  NO_CANCELABLE: "Este turno ya no se puede cancelar.",
  FUERA_DE_PLAZO: "Ya pasó el plazo para cancelar online. Comunicate con el negocio.",
};

type ErrorPg = { message?: string; code?: string; details?: string } | null | undefined;

export function mensajeDeError(error: ErrorPg, porDefecto = "Ocurrió un error. Probá de nuevo."): string {
  if (!error) return porDefecto;
  const texto = error.message ?? "";
  for (const [codigo, mensaje] of Object.entries(MENSAJES)) {
    if (texto.includes(codigo)) return mensaje;
  }
  switch (error.code) {
    case "23505":
      return "Ya existe un registro con esos datos.";
    case "23503":
      return "No se puede completar porque hay datos relacionados (por ejemplo, turnos).";
    case "23P01":
      if (texto.includes("horarios_profesional")) return "Hay franjas horarias que se superponen.";
      return "Ese horario se superpone con otro turno.";
    case "23514":
      return "Algún dato no tiene un valor válido.";
    case "42501":
      return "No tenés permiso para hacer eso.";
  }
  return porDefecto;
}
