import "server-only";

export type Email = { para: string; asunto: string; html: string; texto: string; responderA?: string | null };

/**
 * Envía un mail con Resend (API HTTP, sin SDK). Si RESEND_API_KEY no está
 * configurada, no envía nada y lo deja registrado en consola: así la app
 * funciona igual en desarrollo.
 */
export async function enviarEmail(email: Email): Promise<{ ok: boolean; omitido?: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const remitente = process.env.EMAIL_FROM;
  if (!apiKey || !remitente) {
    console.info(`[email omitido: falta RESEND_API_KEY/EMAIL_FROM] para=${email.para} asunto="${email.asunto}"`);
    return { ok: true, omitido: true };
  }

  try {
    const respuesta = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: remitente,
        to: [email.para],
        subject: email.asunto,
        html: email.html,
        text: email.texto,
        ...(email.responderA ? { reply_to: email.responderA } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!respuesta.ok) {
      const detalle = await respuesta.text().catch(() => "");
      console.error(`[email] Resend respondió ${respuesta.status}: ${detalle.slice(0, 300)}`);
      return { ok: false, error: `HTTP ${respuesta.status}` };
    }
    return { ok: true };
  } catch (e) {
    console.error("[email] error de red", e);
    return { ok: false, error: e instanceof Error ? e.message : "error" };
  }
}
