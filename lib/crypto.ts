import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

function toKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY deve ter exatamente 32 bytes em base64 (gere com: openssl rand -base64 32)");
  }
  return key;
}

/** AES-256-GCM. Formato: v1.<iv>.<tag>.<ciphertext> (base64url). */
export function encrypt(plaintext: string, base64Key: string): string {
  const key = toKey(base64Key);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, ct].map((p, i) => (i === 0 ? p : (p as Buffer).toString("base64url"))).join(".");
}

export function decrypt(payload: string, base64Key: string): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error("Formato de dado criptografado inválido");
  const [, iv, tag, ct] = parts.map((p, i) => (i === 0 ? p : Buffer.from(p!, "base64url"))) as [string, Buffer, Buffer, Buffer];
  const decipher = createDecipheriv("aes-256-gcm", toKey(base64Key), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
