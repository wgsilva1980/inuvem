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

/**
 * Para rotas POST chamadas pela própria tela: recusa requisições que o navegador marcou como vindas de outro site.
 * Sem `Origin` (curl, servidores) passa: só o navegador anexa o cookie de sessão de uma vítima, e ele sempre manda `Origin`
 * em POST. É uma segunda barreira; a primeira é o cookie de sessão `SameSite=Lax`.
 */
export function isSameOrigin(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** O painel administra uma loja só: depois de conectada, só aceita reconectar a mesma. Evita trocar de loja por um callback forjado. */
export function mayConnectStore(existingNuvemshopId: string | number | null | undefined, incoming: number): boolean {
  return existingNuvemshopId === null || existingNuvemshopId === undefined || Number(existingNuvemshopId) === incoming;
}
