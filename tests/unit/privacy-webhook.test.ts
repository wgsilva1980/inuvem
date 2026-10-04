import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { verifyWebhookSignature } from "@/lib/nuvemshop/webhook-verify";
import { redactStore } from "@/lib/privacy";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import { upsertProducts, type Db } from "@/lib/sync/repo";

const secret = "segredo-do-app";
const body = JSON.stringify({ store_id: 123 });
const sign = (b: string, enc: "hex" | "base64") => createHmac("sha256", secret).update(b).digest(enc);

describe("verifyWebhookSignature", () => {
  it("aceita HMAC-SHA256 em hex e base64", () => {
    expect(verifyWebhookSignature(body, sign(body, "hex"), secret)).toBe(true);
    expect(verifyWebhookSignature(body, sign(body, "base64"), secret)).toBe(true);
  });
  it("rejeita assinatura ausente, errada, corpo alterado ou segredo errado", () => {
    expect(verifyWebhookSignature(body, null, secret)).toBe(false);
    expect(verifyWebhookSignature(body, "deadbeef", secret)).toBe(false);
    expect(verifyWebhookSignature(body + " ", sign(body, "hex"), secret)).toBe(false);
    expect(verifyWebhookSignature(body, sign(body, "hex"), "outro")).toBe(false);
    expect(verifyWebhookSignature(body, sign(body, "hex"), "")).toBe(false);
  });
});

describe("redactStore (LGPD store/redact)", () => {
  it("apaga a loja e todos os dados dela (cascade) e é idempotente", async () => {
    const pg = new PGlite();
    await runMigrations(
      { exec: async (s) => void (await pg.exec(s)), query: async (s, p) => (await pg.query(s, p)).rows as never },
      loadMigrations(join(process.cwd(), "db/migrations")),
    );
    const db: Db = { query: async (t, p) => (await pg.query(t, p as never)).rows as never };
    const { rows } = await pg.query<{ id: string }>(
      "INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (123, 'tok'), (456, 'tok2') RETURNING id",
    );
    await upsertProducts(db, rows[0]!.id, [
      { id: 1, name: { pt: "A" }, variants: [{ id: 10, product_id: 1, sku: "S" }] },
    ]);
    await pg.query("INSERT INTO audit_log (store_id, actor_email, acao, entidade) VALUES ($1,'a@b.c','x','produto')", [rows[0]!.id]);

    expect(await redactStore(db, 123)).toBe(1);
    expect((await pg.query("SELECT 1 FROM products")).rows).toHaveLength(0);
    expect((await pg.query("SELECT 1 FROM variants")).rows).toHaveLength(0);
    expect((await pg.query("SELECT nuvemshop_store_id FROM stores")).rows).toEqual([{ nuvemshop_store_id: 456 }]);
    expect(await redactStore(db, 123)).toBe(0);
  });
});
