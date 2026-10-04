import { timingSafeEqual } from "node:crypto";

/** Comparação em tempo constante (evita vazar o segredo por tempo de resposta). */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Valida "Authorization: Bearer <CRON_SECRET>" (formato enviado pela Vercel nos crons). */
export function isValidCronAuth(header: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  const [scheme, token] = header.split(" ");
  return scheme === "Bearer" && !!token && safeEqual(token, secret);
}
