import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Header de assinatura dos webhooks (A CONFIRMAR na documentação oficial): `x-linkedstore-hmac-sha256`,
 * HMAC-SHA256 do corpo bruto usando o client_secret do app. Aceitamos hex ou base64.
 */
export const SIGNATURE_HEADER = "x-linkedstore-hmac-sha256";

export function verifyWebhookSignature(rawBody: string, signature: string | null, clientSecret: string): boolean {
  if (!signature || !clientSecret) return false;
  const digest = createHmac("sha256", clientSecret).update(rawBody, "utf8").digest();
  const candidates = [Buffer.from(signature.trim(), "hex"), Buffer.from(signature.trim(), "base64")];
  return candidates.some((c) => c.length === digest.length && timingSafeEqual(c, digest));
}
