import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import { upsertCategories, upsertProducts, type Db } from "@/lib/sync/repo";
import { PAGE_SIZE, escapeLike, getProductDetail, listCatalog } from "@/lib/catalog/query";
import { buildProductInput, changedFields, productEditSchema, toEdit, type ProductEdit } from "@/lib/catalog/edit";
import { ProductConflictError, ProductNotFoundError, updateProduct, type ProductApi } from "@/lib/catalog/update";
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
});

function product(id: number, over: Partial<Product> = {}): Product {
  return {
    id,
    name: { pt: `Produto ${id}` },
    description: { pt: "<p>desc</p>" },
    handle: { pt: `produto-${id}` },
    published: true,
    tags: "a,b",
    categories: [{ id: 10, name: { pt: "Vestidos" } }],
    images: [{ id: id * 10, product_id: id, src: "https://x/y.jpg" }],
    seo_title: { pt: "Titulo SEO" },
    seo_description: { pt: "Descricao SEO" },
    variants: [{ id: id * 100, product_id: id, sku: `SKU-${id}`, price: "100.00", stock: 3, stock_management: true, values: [{ pt: "P" }] }],
    updated_at: "2026-10-01T10:00:00+0000",
    ...over,
  };
}

describe("listCatalog", () => {
  beforeEach(async () => {
    await upsertCategories(db, storeId, [
      { id: 10, name: { pt: "Vestidos" } },
      { id: 20, name: { pt: "Blusas" } },
    ]);
    await upsertProducts(db, storeId, [
      product(1, { name: { pt: "Vestido Azul" } }),
      product(2, { name: { pt: "Blusa 100% Seda" }, published: false, categories: [{ id: 20, name: { pt: "Blusas" } }], updated_at: "2026-10-03T10:00:00+0000" }),
      product(3, { name: { pt: "Saia" }, variants: [{ id: 301, product_id: 3, sku: "", price: "50.00" }, { id: 302, product_id: 3, sku: "S-2", price: "80.00" }] }),
    ]);
  });

  it("lista tudo ordenado por nome, com agregados das variantes", async () => {
    const r = await listCatalog(db, storeId);
    expect(r.total).toBe(3);
    expect(r.items.map((i) => i.name)).toEqual(["Blusa 100% Seda", "Saia", "Vestido Azul"]);
    const saia = r.items.find((i) => i.name === "Saia")!;
    expect(saia.variant_count).toBe(2);
    expect(Number(saia.price_min)).toBe(50);
    expect(Number(saia.price_max)).toBe(80);
  });

  it("busca por nome e por SKU, sem curingas", async () => {
    expect((await listCatalog(db, storeId, { q: "vestido" })).items.map((i) => i.id)).toEqual(["1"]);
    expect((await listCatalog(db, storeId, { q: "s-2" })).items.map((i) => i.id)).toEqual(["3"]);
    expect((await listCatalog(db, storeId, { q: "100%" })).items.map((i) => i.id)).toEqual(["2"]);
    expect((await listCatalog(db, storeId, { q: "%" })).total).toBe(1); // só o nome com "%" literal
    expect(escapeLike("a_b%c\\")).toBe("a\\_b\\%c\\\\");
  });

  it("filtra por situação, categoria e variante sem SKU", async () => {
    expect((await listCatalog(db, storeId, { status: "rascunhos" })).items.map((i) => i.id)).toEqual(["2"]);
    expect((await listCatalog(db, storeId, { status: "publicados" })).total).toBe(2);
    expect((await listCatalog(db, storeId, { categoryId: 20 })).items.map((i) => i.id)).toEqual(["2"]);
    expect((await listCatalog(db, storeId, { semSku: true })).items.map((i) => i.id)).toEqual(["3"]);
  });

  it("ordena por atualização e limita a página", async () => {
    expect((await listCatalog(db, storeId, { sort: "atualizados" })).items[0]!.id).toBe("2");
    const many = Array.from({ length: PAGE_SIZE + 5 }, (_, i) => product(1000 + i));
    await upsertProducts(db, storeId, many);
    const p1 = await listCatalog(db, storeId, { page: 1 });
    const p2 = await listCatalog(db, storeId, { page: 2 });
    expect(p1.items).toHaveLength(PAGE_SIZE);
    expect(p1.pages).toBe(2);
    expect(p2.items).toHaveLength(3 + 5);
    expect((await listCatalog(db, storeId, { page: 99 })).page).toBe(2); // fora do intervalo -> última
  });
});

describe("edição", () => {
  const base: ProductEdit = { name: "A", description: "d", tags: "x,y", published: true, seo_title: "t", seo_description: "s", categories: [1, 2] };

  it("valida e normaliza", () => {
    expect(productEditSchema.safeParse({ ...base, name: "  " }).success).toBe(false);
    expect(productEditSchema.safeParse({ ...base, seo_title: "x".repeat(71) }).success).toBe(false);
    expect(productEditSchema.parse({ ...base, tags: " a , b,, c " }).tags).toBe("a,b,c");
  });

  it("detecta só o que mudou e monta o corpo no idioma pt", () => {
    const after = { ...base, name: "B", published: false, categories: [2, 3] };
    const fields = changedFields(base, after);
    expect(fields).toEqual(["name", "published", "categories"]);
    expect(buildProductInput(after, fields)).toEqual({ name: { pt: "B" }, published: false, categories: [2, 3] });
    expect(changedFields(base, { ...base, categories: [2, 1] })).toEqual([]); // ordem não conta
  });
});

describe("updateProduct", () => {
  const actor = "admin@example.com";
  const auditRows = async () => (await pg.query("SELECT acao, entidade_id, sucesso, antes, depois FROM audit_log ORDER BY id")).rows as Array<Record<string, unknown>>;

  async function edit(over: Partial<ProductEdit>) {
    const detail = (await getProductDetail(db, storeId, 1))!;
    return { ...toEdit(detail), ...over };
  }

  beforeEach(async () => {
    await upsertCategories(db, storeId, [{ id: 10, name: { pt: "Vestidos" } }]);
    await upsertProducts(db, storeId, [product(1)]);
  });

  it("envia só o alterado, atualiza o espelho e registra no histórico", async () => {
    const calls: unknown[] = [];
    const api: ProductApi = {
      get: async () => product(1),
      put: async (_id, input) => {
        calls.push(input);
        return product(1, { name: { pt: "Novo nome" }, updated_at: "2026-10-04T10:00:00+0000" });
      },
    };
    const r = await updateProduct(db, api, { storeId, actor, productId: 1, after: await edit({ name: "Novo nome" }) });
    expect(r).toEqual({ changed: true, fields: ["name"] });
    expect(calls).toEqual([{ name: { pt: "Novo nome" } }]);
    expect((await getProductDetail(db, storeId, 1))!.name).toBe("Novo nome");
    const [log] = await auditRows();
    expect(log).toMatchObject({ acao: "produto.atualizar", entidade_id: "1", sucesso: true, antes: { name: "Produto 1" }, depois: { name: "Novo nome" } });
  });

  it("não chama a API quando nada mudou", async () => {
    const api: ProductApi = { get: async () => { throw new Error("não deveria"); }, put: async () => { throw new Error("não deveria"); } };
    expect(await updateProduct(db, api, { storeId, actor, productId: 1, after: await edit({}) })).toEqual({ changed: false });
    expect(await auditRows()).toHaveLength(0);
  });

  it("recusa e atualiza o espelho se a Nuvemshop mudou o produto por fora", async () => {
    let put = false;
    const api: ProductApi = {
      get: async () => product(1, { name: { pt: "Mudou na loja" }, updated_at: "2026-10-04T09:00:00+0000" }),
      put: async () => { put = true; return product(1); },
    };
    await expect(updateProduct(db, api, { storeId, actor, productId: 1, after: await edit({ name: "Meu nome" }) })).rejects.toBeInstanceOf(ProductConflictError);
    expect(put).toBe(false);
    expect((await getProductDetail(db, storeId, 1))!.name).toBe("Mudou na loja");
  });

  it("detecta mudança por fora pelo conteúdo, mesmo com updated_at igual (a loja não o atualiza)", async () => {
    let put = false;
    const api: ProductApi = {
      get: async () => product(1, { description: { pt: "<p>mudou na loja</p>" } }), // mesmo updated_at do espelho
      put: async () => { put = true; return product(1); },
    };
    await expect(updateProduct(db, api, { storeId, actor, productId: 1, after: await edit({ name: "Meu nome" }) })).rejects.toBeInstanceOf(ProductConflictError);
    expect(put).toBe(false);
    expect((await getProductDetail(db, storeId, 1))!.description).toBe("<p>mudou na loja</p>");
  });

  it("não acusa conflito só porque o updated_at mudou ou as tags têm espaços", async () => {
    await upsertProducts(db, storeId, [product(1, { tags: "a, b" })]);
    const api: ProductApi = {
      get: async () => product(1, { tags: "a, b", updated_at: "2026-10-09T10:00:00+0000" }),
      put: async () => product(1, { name: { pt: "Novo" }, tags: "a, b" }),
    };
    expect(await updateProduct(db, api, { storeId, actor, productId: 1, after: await edit({ name: "Novo" }) })).toEqual({ changed: true, fields: ["name"] });
  });

  it("registra a falha da API no histórico e não altera o espelho", async () => {
    const api: ProductApi = {
      get: async () => product(1),
      put: async () => { throw new NuvemshopError("422", 422, { description: "nome inválido" }, "nome inválido"); },
    };
    await expect(updateProduct(db, api, { storeId, actor, productId: 1, after: await edit({ name: "X" }) })).rejects.toBeInstanceOf(NuvemshopError);
    expect((await getProductDetail(db, storeId, 1))!.name).toBe("Produto 1");
    expect(await auditRows()).toMatchObject([{ sucesso: false, depois: { name: "X" } }]);
  });

  it("falha se o produto não existe no espelho", async () => {
    const api: ProductApi = { get: async () => product(9), put: async () => product(9) };
    const after = await edit({});
    await expect(updateProduct(db, api, { storeId, actor, productId: 9, after })).rejects.toBeInstanceOf(ProductNotFoundError);
  });
});
