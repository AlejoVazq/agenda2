import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Cifrado simétrico (AES-256-GCM) para guardar tokens de terceros en la base.
// La clave sale de INTEGRACIONES_CLAVE (mínimo 32 caracteres); si se pierde o se
// cambia, hay que volver a conectar las integraciones.

function clave() {
  const secreto = process.env.INTEGRACIONES_CLAVE ?? "";
  if (secreto.length < 32) throw new Error("Falta INTEGRACIONES_CLAVE (mínimo 32 caracteres).");
  return createHash("sha256").update(secreto).digest();
}

export function cifrar(datos: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", clave(), iv);
  const cuerpo = Buffer.concat([cipher.update(JSON.stringify(datos), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), cuerpo.toString("base64url")].join(".");
}

export function descifrar<T>(texto: string): T {
  const [version, iv, tag, cuerpo] = texto.split(".");
  if (version !== "v1" || !iv || !tag || !cuerpo) throw new Error("Formato de secreto desconocido.");
  const decipher = createDecipheriv("aes-256-gcm", clave(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const plano = Buffer.concat([decipher.update(Buffer.from(cuerpo, "base64url")), decipher.final()]);
  return JSON.parse(plano.toString("utf8")) as T;
}
