import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import { startOrResumeRun, stepRun, type SyncSource } from "@/lib/sync/engine";
import { mapProduct, toNumber } from "@/lib/sync/mappers";
import type { Db } from "@/lib/sync/repo";
import type { Product } from "@/lib/nuvemshop/types";

let pg: PGlite;
let db: Db;
let storeId: string;

beforeEach(async () => {
  pg = new PGlite();
  db = { query: async (text, params) => (await pg.query(text, params as never)).rows as never };
  await runMigrations(
    { exec: async (s) => void (await pg.exec(s)), query: async (s, p) => (await pg.query(s, p)).rows as never },
    loadMigrations(join(process.cwd(), "db/migrations")),
  );
  const { rows } = await pg.query<{ id: string }>(
    "INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (1, 'x') RETURNING id",
  );
  storeId = rows[0]!.id;
});

function product(id: number, over: Partial<Product> = {}): Product {
  return {
    id,
    name: { pt: `Produto ${id}` },
    description: { pt: "desc" },
    handle: { pt: `produto-${id}` },
    published: true,
    tags: "a,b",
    categories: [{ id: 10, name: { pt: "Vestidos" } }],
    images: [{ id: id * 10, product_id: id, src: "https://x/y.jpg" }],
    variants: [
      { id: id * 100, product_id: id, sku: `SKU-${id}`, price: "199.90", promotional_price: "149.90", stock: 3, stock_management: true, values: [{ pt: "P" }] },
    ],
    updated_at: "2026-10-01T10:00:00+0000",
    ...over,
  };
}

function fakeSource(pages: Product[][], calls: Array<Record<string, unknown>> = []): SyncSource {
  return {
    listCategories: async () => [{ id: 10, name: { pt: "Vestidos" }, parent: null }],
    listProductsPage: async (p) => {
      calls.push(p);
      const items = pages[p.page - 1] ?? [];
      return { items, nextPage: p.page < pages.length ? p.page + 1 : null };
    },
  };
}

describe("sync engine", () => {
  it("sincroniza tudo e é retomável entre chamadas (orçamento de tempo)", async () => {
    const source = fakeSource([[product(1), product(2)], [product(3)]]);
    let run = await startOrResumeRun(db, storeId, "auto");
    expect(run.tipo).toBe("full");

    // budget 0: processa uma página por chamada
    let step = await stepRun(db, source, run, { budgetMs: 0 });
    expect(step.done).toBe(false);
    expect(step.run.cursor.page).toBe(2);

    // "nova invocação": retoma do banco
    run = await startOrResumeRun(db, storeId, "auto");
    expect(run.id).toBe(step.run.id);
    expect(run.cursor.page).toBe(2);
    step = await stepRun(db, source, run, { budgetMs: 0 });
    expect(step.done).toBe(true);
    expect(step.run.totais).toMatchObject({ products: 3, variants: 3, categories: 1, pages: 2 });

    const { rows } = await pg.query<{ n: string }>("SELECT count(*)::text AS n FROM products");
    expect(rows[0]!.n).toBe("3");
    const v = await pg.query<{ sku: string; price: string; promotional_price: string }>(
      "SELECT sku, price::text, promotional_price::text FROM variants WHERE product_id = 1",
    );
    expect(v.rows[0]).toEqual({ sku: "SKU-1", price: "199.90", promotional_price: "149.90" });
  });

  it("é idempotente (rodar de novo não duplica)", async () => {
    const source = fakeSource([[product(1)]]);
    for (let i = 0; i < 2; i++) {
      const run = await startOrResumeRun(db, storeId, "full");
      await stepRun(db, source, run, { budgetMs: 1000 });
    }
    expect((await pg.query("SELECT 1 FROM products")).rows).toHaveLength(1);
    expect((await pg.query("SELECT 1 FROM variants")).rows).toHaveLength(1);
  });

  it("full remove do espelho o que sumiu da Nuvemshop; variantes removidas também", async () => {
    let run = await startOrResumeRun(db, storeId, "full");
    await stepRun(db, fakeSource([[product(1), product(2)]]), run, { budgetMs: 1000 });
    // 2 foi excluído na loja; 1 perdeu a variante
    run = await startOrResumeRun(db, storeId, "full");
    const res = await stepRun(db, fakeSource([[product(1, { variants: [] })]]), run, { budgetMs: 1000 });
    expect(res.run.totais.pruned_products).toBe(1);
    expect((await pg.query("SELECT id FROM products")).rows).toEqual([{ id: 1 }]);
    expect((await pg.query("SELECT 1 FROM variants")).rows).toHaveLength(0);
  });

  it("incremental usa a marca d'água do último sync completo e não apaga nada", async () => {
    let run = await startOrResumeRun(db, storeId, "auto");
    await stepRun(db, fakeSource([[product(1), product(2)]]), run, { budgetMs: 1000 });
    const calls: Array<Record<string, unknown>> = [];
    run = await startOrResumeRun(db, storeId, "auto");
    expect(run.tipo).toBe("incremental");
    expect(run.cursor.updated_at_min).toBeTruthy();
    await stepRun(db, fakeSource([[product(1)]], calls), run, { budgetMs: 1000 });
    expect(calls[0]!.updated_at_min).toBe(run.cursor.updated_at_min);
    expect((await pg.query("SELECT 1 FROM products")).rows).toHaveLength(2);
  });

  it("só permite uma execução em andamento e marca como falha após erros repetidos", async () => {
    const a = await startOrResumeRun(db, storeId, "full");
    const b = await startOrResumeRun(db, storeId, "full");
    expect(b.id).toBe(a.id);

    const broken: SyncSource = { listCategories: async () => [], listProductsPage: async () => { throw new Error("boom"); } };
    await expect(stepRun(db, broken, a, { budgetMs: 1000, maxErrors: 1 })).rejects.toThrow("boom");
    const { rows } = await pg.query<{ status: string }>("SELECT status FROM sync_runs WHERE id = $1", [a.id]);
    expect(rows[0]!.status).toBe("failed");
    // após falhar, uma nova execução pode começar
    expect((await startOrResumeRun(db, storeId, "full")).id).not.toBe(a.id);
  });
});

describe("mappers", () => {
  it("converte preços e idiomas", () => {
    expect(toNumber("199.90")).toBe(199.9);
    expect(toNumber(null)).toBeNull();
    expect(toNumber("abc")).toBeNull();
    const row = mapProduct(product(7, { name: { es: "Vestido" } }));
    expect(row.name).toBe("Vestido"); // sem pt: usa o primeiro idioma
    expect(row.image_count).toBe(1);
    expect(row.updated_at_remote).toBe("2026-10-01T10:00:00.000Z");
  });
});
