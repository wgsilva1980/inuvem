import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { checkEnv } from "@/lib/health";

const good = {
  DATABASE_URL: "postgresql://u:senha123@ep-abc-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require",
  NEON_AUTH_BASE_URL: "https://ep-abc.neonauth.sa-east-1.aws.neon.tech/neondb/auth",
  NEON_AUTH_COOKIE_SECRET: randomBytes(32).toString("base64"),
  NUVEMSHOP_APP_ID: "44897",
  NUVEMSHOP_CLIENT_ID: "44897",
  NUVEMSHOP_CLIENT_SECRET: "abc123",
  NUVEMSHOP_CONTACT_EMAIL: "dono@loja.com.br",
  ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  CRON_SECRET: randomBytes(32).toString("hex"),
  APP_URL: "https://inuvem.vercel.app",
};

describe("checkEnv", () => {
  it("aprova uma configuração completa", () => {
    expect(checkEnv(good)).toMatchObject({ ok: true, missing: [], invalid: [], warnings: [] });
  });
  it("lista variáveis ausentes e vazias, sem expor valores", () => {
    const r = checkEnv({ ...good, CRON_SECRET: "", ENCRYPTION_KEY: undefined });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(expect.arrayContaining(["CRON_SECRET", "ENCRYPTION_KEY"]));
    expect(JSON.stringify(r)).not.toContain(good.NUVEMSHOP_CLIENT_SECRET);
  });
  it("detecta chave de criptografia inválida, placeholders e segredos curtos", () => {
    const r = checkEnv({
      ...good,
      ENCRYPTION_KEY: "curta",
      NEON_AUTH_COOKIE_SECRET: "curto",
      DATABASE_URL: "postgresql://neondb_owner:SUA_SENHA@ep-x.neon.tech/neondb",
    });
    const names = r.invalid.map((i) => i.name);
    expect(names).toEqual(expect.arrayContaining(["ENCRYPTION_KEY", "NEON_AUTH_COOKIE_SECRET", "DATABASE_URL"]));
  });
  it("detecta valores colados com aspas ou espaços (erro comum na Vercel)", () => {
    const r = checkEnv({
      ...good,
      NUVEMSHOP_CONTACT_EMAIL: `"${good.NUVEMSHOP_CONTACT_EMAIL}"`,
      APP_URL: `'${good.APP_URL}'`,
      ENCRYPTION_KEY: ` ${good.ENCRYPTION_KEY}`,
    });
    expect(r.invalid.map((i) => i.name).sort()).toEqual(["APP_URL", "ENCRYPTION_KEY", "NUVEMSHOP_CONTACT_EMAIL"]);
    expect(r.invalid.every((i) => i.problem.includes("SEM aspas"))).toBe(true);
  });
  it("marca variáveis Sensitive da Vercel como não verificáveis (nunca como OK)", () => {
    const r = checkEnv({ ...good, NUVEMSHOP_CLIENT_SECRET: "[SENSITIVE]", ENCRYPTION_KEY: "[SENSITIVE]", CRON_SECRET: "SENSITIVE" });
    expect(r.ok).toBe(false);
    expect(r.invalid).toEqual([]);
    expect(r.unverifiable.sort()).toEqual(["CRON_SECRET", "ENCRYPTION_KEY", "NUVEMSHOP_CLIENT_SECRET"]);
  });
  it("acusa APP_URL apontando para localhost somente em produção", () => {
    const local = { ...good, APP_URL: "http://localhost:3000" };
    expect(checkEnv(local).ok).toBe(true); // desenvolvimento local é normal
    const r = checkEnv({ ...local, VERCEL_ENV: "production" });
    expect(r.ok).toBe(false);
    expect(r.invalid).toEqual([{ name: "APP_URL", problem: expect.stringContaining("localhost") }]);
    expect(checkEnv({ ...good, VERCEL_ENV: "production" }).ok).toBe(true);
  });
  it("avisa sobre connection string não pooled, http em produção e client id diferente", () => {
    const r = checkEnv({
      ...good,
      DATABASE_URL: "postgresql://u:p@ep-abc.sa-east-1.aws.neon.tech/neondb",
      APP_URL: "http://inuvem.vercel.app",
      NUVEMSHOP_CLIENT_ID: "99",
    });
    expect(r.ok).toBe(true);
    expect(r.warnings).toHaveLength(3);
  });
});
