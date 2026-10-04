import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { createHmac } from "node:crypto";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import { upsertCategories, upsertProducts, type Db } from "@/lib/sync/repo";
import { DEDUPE_WINDOW_MS, WEBHOOK_EVENTS, handleWebhook, type ResourceApi, type WebhookDeps } from "@/lib/webhooks/handler";
import { ensureWebhooks } from "@/lib/webhooks/register";
import { NuvemshopError } from "@/lib/nuvemshop/errors";
import type { Category, Product } from "@/lib/nuvemshop/types";

const SECRET = "segredo-do-app";
let pg: PGlite;
let db: Db;
let storeId: string;
let clock: number;
let api: ResourceApi;
let logs: Array<Record<string, unknown>>;

const sign = (body: string) => createHmac("sha256", SECRET).update(body).digest("hex");
const body = (event: string, id: number, store = 1) => JSON.stringify({ store_id: store, event, id });

function deps(): WebhookDeps {
  return {
    db,
    clientSecret: SECRET,
    findStore: async (n) => (n === 1 ? { id: storeId, nuvemshop_store_id: "1" } : null),
    apiFor: async () => api,
    now: () => clock,
    log: (e) => logs.push(e),
  };
}
const send = (raw: string, signature: string | null = sign(raw)) => handleWebhook(deps(), raw, signature);

const product = (id: number, name = `Produto ${id}`, categories = [{ id: 10, name: { pt: "Vestidos" } }]): Product => ({
  id,
  name: { pt: name },
  published: true,
  categories,
  variants: [{ id: id * 100, product_id: id, sku: `S-${id}`, price: "10.00" }],
  updated_at: "2026-10-01T10:00:00+0000",
});

beforeEach(async () => {
  pg = new PGlite();
  db = { query: async (text, params) => (await pg.query(text, params as never)).rows as never };
  await runMigrations(
    { exec: async (s) => void (await pg.exec(s)), query: async (s, p) => (await pg.query(s, p)).rows as never },
    loadMigrations(join(process.cwd(), "db/migrations")),
  );
  const { rows } = await pg.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (1, 'x') RETURNING id");
  storeId = rows[0]!.id;
  clock = 1_000_000;
  logs = [];
  api = {
    getProduct: async (id) => product(id, "Nome na loja"),
    getCategory: async (id) => ({ id, name: { pt: "Categoria na loja" } }) as Category,
  };
  await upsertCategories(db, storeId, [{ id: 10, name: { pt: "Vestidos" } } as Category]);
  await upsertProducts(db, storeId, [product(1)]);
});

const names = async () => (await pg.query<{ name: string }>("SELECT name FROM products ORDER BY id")).rows.map((r) => r.name);

describe("handleWebhook", () => {
  it("recusa assinatura inválida ou ausente, sem tocar no banco", async () => {
    expect((await send(body("product/updated", 1), "00")).status).toBe(401);
    expect((await send(body("product/updated", 1), null)).status).toBe(401);
    expect(await names()).toEqual(["Produto 1"]);
    expect((await pg.query("SELECT 1 FROM webhook_events")).rows).toHaveLength(0);
  });

  it("recusa corpo inválido (assinado)", async () => {
    expect((await send("não é json")).status).toBe(400);
    expect((await send(JSON.stringify({ store_id: 1, event: "product/updated" }))).status).toBe(400);
  });

  it("product/updated busca o estado atual na API e atualiza o espelho", async () => {
    expect((await send(body("product/updated", 1))).status).toBe(200);
    expect(await names()).toEqual(["Nome na loja"]);
  });

  it("product/created insere o produto novo com as variantes", async () => {
    await send(body("product/created", 2));
    expect(await names()).toEqual(["Produto 1", "Nome na loja"]);
    expect((await pg.query("SELECT count(*)::int AS n FROM variants WHERE product_id = 2")).rows[0]).toEqual({ n: 1 });
  });

  it("product/deleted remove o produto e as variantes", async () => {
    await send(body("product/deleted", 1));
    expect(await names()).toEqual([]);
    expect((await pg.query("SELECT 1 FROM variants")).rows).toHaveLength(0);
  });

  it("product/updated de produto que já foi apagado (404) remove do espelho", async () => {
    api.getProduct = async () => {
      throw new NuvemshopError("404", 404, null);
    };
    expect((await send(body("product/updated", 1))).status).toBe(200);
    expect(await names()).toEqual([]);
  });

  it("category/updated e category/created gravam a categoria", async () => {
    await send(body("category/updated", 10));
    await send(body("category/created", 11));
    const rows = (await pg.query<{ id: string; name: string }>("SELECT id::text, name FROM categories ORDER BY id")).rows;
    expect(rows).toEqual([
      { id: "10", name: "Categoria na loja" },
      { id: "11", name: "Categoria na loja" },
    ]);
  });

  it("category/deleted remove a categoria e a tira dos produtos", async () => {
    await upsertProducts(db, storeId, [product(3, "Com duas", [{ id: 10, name: { pt: "Vestidos" } }, { id: 20, name: { pt: "Blusas" } }])]);
    await send(body("category/deleted", 10));
    expect((await pg.query("SELECT 1 FROM categories WHERE id = 10")).rows).toHaveLength(0);
    const cats = (await pg.query<{ id: string; categories: unknown }>("SELECT id::text, categories FROM products ORDER BY id")).rows;
    expect(cats).toEqual([
      { id: "1", categories: [] },
      { id: "3", categories: [{ id: 20, name: "Blusas" }] },
    ]);
  });

  it("ignora evento não tratado e loja desconhecida (200, sem reenvio)", async () => {
    expect(await send(body("order/created", 1))).toMatchObject({ status: 200, body: { ignored: true } });
    expect(await send(body("product/updated", 1, 999))).toMatchObject({ status: 200, body: { ignored: true } });
    expect(await names()).toEqual(["Produto 1"]);
  });

  it("descarta repetição imediata, mas processa o mesmo evento depois da janela", async () => {
    let calls = 0;
    api.getProduct = async (id) => product(id, `v${++calls}`);
    const raw = body("product/updated", 1);
    expect((await send(raw)).body).toEqual({ ok: true });
    expect((await send(raw)).body).toEqual({ duplicate: true });
    expect(calls).toBe(1);
    clock += DEDUPE_WINDOW_MS * 2;
    expect((await send(raw)).body).toEqual({ ok: true });
    expect(calls).toBe(2);
    expect(await names()).toEqual(["v2"]);
  });

  it("em falha devolve 500 e libera o reenvio (sem registro de deduplicação)", async () => {
    let fail = true;
    api.getProduct = async (id) => {
      if (fail) throw new Error("API fora do ar");
      return product(id, "Recuperado");
    };
    const raw = body("product/updated", 1);
    expect((await send(raw)).status).toBe(500);
    expect((await pg.query("SELECT 1 FROM webhook_events")).rows).toHaveLength(0);
    fail = false;
    expect((await send(raw)).status).toBe(200); // mesmo instante: o reenvio não é tratado como duplicado
    expect(await names()).toEqual(["Recuperado"]);
  });

  it("não registra o corpo nem dados pessoais no log", async () => {
    await send(body("product/updated", 1));
    expect(JSON.stringify(logs)).not.toContain("store_id");
  });
});

describe("ensureWebhooks", () => {
  const url = "https://painel.example/api/webhooks/nuvemshop";

  it("cria só o que falta e reporta o que já existe ou aponta para outra URL", async () => {
    const created: string[] = [];
    const result = await ensureWebhooks(
      {
        list: async () => [
          { id: 1, event: "product/created", url },
          { id: 2, event: "product/updated", url: "https://outro.example/hook" },
        ],
        create: async ({ event }) => void created.push(event),
      },
      url,
    );
    expect(result.existing).toEqual(["product/created"]);
    expect(result.otherUrl).toEqual(["product/updated"]);
    expect(created).toEqual(WEBHOOK_EVENTS.filter((e) => e !== "product/created"));
    expect(result.failed).toEqual([]);
  });

  it("é idempotente e relata falhas por evento", async () => {
    const all = WEBHOOK_EVENTS.map((event, i) => ({ id: i, event, url }));
    expect((await ensureWebhooks({ list: async () => all, create: async () => { throw new Error("não deveria"); } }, url)).created).toEqual([]);

    const result = await ensureWebhooks(
      {
        list: async () => [],
        create: async ({ event }) => {
          if (event === "category/deleted") throw new Error("sem permissão");
        },
      },
      url,
    );
    expect(result.failed).toEqual([{ event: "category/deleted", message: "sem permissão" }]);
    expect(result.created).toHaveLength(WEBHOOK_EVENTS.length - 1);
  });
});
