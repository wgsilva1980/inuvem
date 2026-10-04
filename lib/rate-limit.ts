import type { Db } from "@/lib/sync/repo";

/**
 * Conta uma tentativa na janela fixa da chave e devolve quantas já houve nela (incluindo esta).
 * Atômico (um UPSERT): chamadas simultâneas não furam o limite.
 */
export async function hit(db: Db, key: string, windowSeconds: number): Promise<number> {
  const rows = await db.query<{ hits: number }>(
    `INSERT INTO rate_limits (key, window_start, hits) VALUES ($1, now(), 1)
     ON CONFLICT (key) DO UPDATE SET
       hits = CASE WHEN rate_limits.window_start < now() - make_interval(secs => $2::int) THEN 1 ELSE rate_limits.hits + 1 END,
       window_start = CASE WHEN rate_limits.window_start < now() - make_interval(secs => $2::int) THEN now() ELSE rate_limits.window_start END
     RETURNING hits`,
    [key, windowSeconds],
  );
  return rows[0]!.hits;
}

export const MAGIC_LINK_LIMITS = {
  perIp: { max: 5, windowSeconds: 15 * 60 },
  global: { max: 30, windowSeconds: 60 * 60 },
} as const;

export interface LimitResult {
  ok: boolean;
  retryAfterSeconds?: number;
}

/**
 * Pedido de link de acesso: por IP (impede uma origem de encher a caixa do administrador ou gastar a cota do remetente de e-mail)
 * e global (teto para qualquer origem). O global só conta pedidos que passaram do limite por IP, para uma origem sozinha não esgotá-lo.
 */
export async function checkMagicLinkLimits(db: Db, ip: string): Promise<LimitResult> {
  const { perIp, global } = MAGIC_LINK_LIMITS;
  if ((await hit(db, `magic:ip:${ip}`, perIp.windowSeconds)) > perIp.max) return { ok: false, retryAfterSeconds: perIp.windowSeconds };
  if ((await hit(db, "magic:global", global.windowSeconds)) > global.max) return { ok: false, retryAfterSeconds: global.windowSeconds };
  // limpeza oportunista de janelas antigas
  await db.query("DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'");
  return { ok: true };
}

/** IP do cliente atrás da Vercel (o primeiro de x-forwarded-for é o do cliente; a Vercel sobrescreve o cabeçalho enviado de fora). */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip")?.trim() || "desconhecido";
  return ip.slice(0, 64);
}
