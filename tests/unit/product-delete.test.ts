import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import { upsertProducts, type Db } from "@/lib/sync/repo";
import { deleteProduct } from "@/lib/catalog/delete";
import { ProductMissingError } from "@/lib/catalog/images";
import { formVariantIds, variantEditSchema, variantFormInput } from "@/lib/catalog/variants";
import { NuvemshopError } from "@/lib/nuvemshop/errors";
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
  const { rows } = await pg.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (1, 'x') RETURNING id");
  storeId = rows[0]!.id;
  const product = {
    id: 1,
    name: { pt: "Vestido X" },
    published: true,
    variants: [{ id: 10, product_id: 1, sku: "A", price: "10.00", stock_management: false, stock: null, values: [{ pt: "Preto" }] }],
  } as unknown as Product;
  await upsertProducts(db, storeId, [product]);
});

const count = async (table: string) => Number(((await pg.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0] as { n: number }).n);
const audits = async () => (await pg.query("SELECT acao, sucesso FROM audit_log")).rows as { acao: string; sucesso: boolean }[];

describe("deleteProduct", () => {
  it("exclui na loja, tira do espelho (com variantes) e registra", async () => {
    const called: number[] = [];
    const r = await deleteProduct(db, { deleteProduct: async (id) => void called.push(id) }, { storeId, actor: "a@x", productId: 1 });
    expect(r.name).toBe("Vestido X");
    expect(called).toEqual([1]);
    expect(await count("products")).toBe(0);
    expect(await count("variants")).toBe(0);
    expect(await audits()).toEqual([{ acao: "produto.apagar", sucesso: true }]);
  });

  it("404 da loja (já excluído lá) só limpa o espelho", async () => {
    await deleteProduct(db, { deleteProduct: async () => Promise.reject(new NuvemshopError("nf", 404, null)) }, { storeId, actor: "a@x", productId: 1 });
    expect(await count("products")).toBe(0);
  });

  it("falha da loja mantém o espelho e registra a falha", async () => {
    await expect(deleteProduct(db, { deleteProduct: async () => Promise.reject(new NuvemshopError("boom", 500, null)) }, { storeId, actor: "a@x", productId: 1 })).rejects.toBeInstanceOf(NuvemshopError);
    expect(await count("products")).toBe(1);
    expect(await audits()).toEqual([{ acao: "produto.apagar", sucesso: false }]);
  });

  it("produto fora do espelho não chama a loja", async () => {
    let called = false;
    await expect(deleteProduct(db, { deleteProduct: async () => void (called = true) }, { storeId, actor: "a@x", productId: 99 })).rejects.toBeInstanceOf(ProductMissingError);
    expect(called).toBe(false);
  });
});

describe("campos das variantes no formulário do produto", () => {
  it("lê ids e campos com prefixo v{id}_", () => {
    const f = new FormData();
    f.append("variant_ids", "10");
    f.append("variant_ids", "11");
    f.append("v10_sku", "A");
    f.append("v10_price", "10,00");
    f.append("v10_value_1", "P");
    f.append("v10_value_0", "Preto");
    f.append("v11_sku", "OUTRO");
    expect(formVariantIds(f)).toEqual([10, 11]);
    const input = variantFormInput(f, 10);
    expect(input.values).toEqual(["Preto", "P"]);
    expect(input.sku).toBe("A");
    expect(variantEditSchema.safeParse(input).success).toBe(true);
    expect(variantFormInput(f, 11).values).toBeUndefined();
  });
});
