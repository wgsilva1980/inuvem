import { join } from "node:path";
import { loadMigrations, pendingMigrations } from "@/lib/db/migrate";
import { checkEnv } from "@/lib/health";
import { isValidCronAuth } from "@/lib/security";

export const dynamic = "force-dynamic";

/**
 * Diagnóstico do deploy. Protegido pelo CRON_SECRET (Authorization: Bearer ...).
 * Mostra apenas NOMES de variáveis com problema, nunca valores.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ ok: false, error: "CRON_SECRET não configurada." }, { status: 503 });
  if (!isValidCronAuth(request.headers.get("authorization"), secret)) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }

  const env = checkEnv(process.env);
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  try {
    const { query } = await import("@/lib/db");
    await query("SELECT 1");
    const migrations = await query<{ name: string }>("SELECT name FROM schema_migrations ORDER BY name");
    const admins = await query<{ n: string }>("SELECT count(*)::text AS n FROM admins");
    checks.database = { ok: true };
    const applied = migrations.map((m) => m.name);
    let expected: string[] = [];
    try {
      expected = loadMigrations(join(process.cwd(), "db/migrations")).map((m) => m.name);
    } catch {
      /* arquivos não empacotados: compara só com o que está aplicado */
    }
    const pending = pendingMigrations(applied, expected);
    checks.migrations = {
      ok: applied.length > 0 && pending.length === 0,
      detail: pending.length
        ? `pendentes: ${pending.join(", ")} (rode npm run db:migrate)`
        : `aplicadas: ${applied.join(", ") || "nenhuma"}`,
    };
    checks.admins = { ok: Number(admins[0]?.n ?? 0) > 0, detail: `${admins[0]?.n ?? 0} liberado(s)` };
  } catch (err) {
    checks.database = { ok: false, detail: err instanceof Error ? err.message.slice(0, 120) : "falha" };
  }

  try {
    const base = process.env.NEON_AUTH_BASE_URL;
    const res = base ? await fetch(`${base}/.well-known/jwks.json`, { signal: AbortSignal.timeout(8000) }) : null;
    checks.neonAuth = { ok: !!res?.ok, detail: res ? `HTTP ${res.status}` : "NEON_AUTH_BASE_URL ausente" };
  } catch {
    checks.neonAuth = { ok: false, detail: "não foi possível alcançar o Neon Auth" };
  }

  const ok = env.ok && Object.values(checks).every((c) => c.ok);
  return Response.json({ ok, env, checks }, { status: ok ? 200 : 500 });
}
