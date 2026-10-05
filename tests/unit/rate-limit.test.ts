import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import type { Db } from "@/lib/sync/repo";
import { MAGIC_LINK_LIMITS, OTP_VERIFY_LIMIT, checkMagicLinkLimits, checkOtpVerifyLimit } from "@/lib/rate-limit";

let db: Db;

beforeEach(async () => {
  const pg = new PGlite();
  db = { query: async (text, params) => (await pg.query(text, params as never)).rows as never };
  await runMigrations(
    { exec: async (s) => void (await pg.exec(s)), query: async (s, p) => (await pg.query(s, p)).rows as never },
    loadMigrations(join(process.cwd(), "db/migrations")),
  );
});

describe("limites de acesso", () => {
  it("pedido de link/código: bloqueia depois do limite por IP, sem afetar outro IP", async () => {
    for (let i = 0; i < MAGIC_LINK_LIMITS.perIp.max; i++) expect((await checkMagicLinkLimits(db, "1.1.1.1")).ok).toBe(true);
    const blocked = await checkMagicLinkLimits(db, "1.1.1.1");
    expect(blocked).toMatchObject({ ok: false, retryAfterSeconds: MAGIC_LINK_LIMITS.perIp.windowSeconds });
    expect((await checkMagicLinkLimits(db, "2.2.2.2")).ok).toBe(true);
  });

  it("digitar o código: bloqueia depois do limite por IP e não gasta o limite de envio", async () => {
    for (let i = 0; i < OTP_VERIFY_LIMIT.max; i++) expect((await checkOtpVerifyLimit(db, "3.3.3.3")).ok).toBe(true);
    expect((await checkOtpVerifyLimit(db, "3.3.3.3")).ok).toBe(false);
    expect((await checkOtpVerifyLimit(db, "4.4.4.4")).ok).toBe(true);
    expect((await checkMagicLinkLimits(db, "3.3.3.3")).ok).toBe(true);
  });
});
