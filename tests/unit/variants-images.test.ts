import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import { upsertProducts, type Db } from "@/lib/sync/repo";
import { buildVariantInput, changedVariantFields, parseMoney, variantEditSchema, variantToEdit } from "@/lib/catalog/variants";
import { VariantConflictError, VariantNotFoundError, updateVariant, type VariantApi } from "@/lib/catalog/update-variant";
import { addImage, getProductImages, imageUrlSchema, moveImage, removeImage, type ImageApi } from "@/lib/catalog/images";
import { NuvemshopError } from "@/lib/nuvemshop/errors";
import type { Product, ProductImage, Variant } from "@/lib/nuvemshop/types";

let pg: PGlite;
let db: Db;
let storeId: string;
const actor = "admin@example.com";

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

describe("parseMoney", () => {
  it.each([
    ["99,90", "99.90"],
    ["99.90", "99.90"],
    ["1.234,56", "1234.56"],
    ["R$ 10", "10.00"],
    ["0,5", "0.50"],
    ["", null],
    ["   ", null],
    ["abc", undefined],
    ["10,999", undefined],
    ["-5", undefined],
    ["1,2,3", undefined],
  ])("%j -> %j", (input, expected) => {
    expect(parseMoney(input)).toBe(expected);
  });
});

describe("variantEditSchema", () => {
  const base = { sku: "A-1", price: "100,00", promotional_price: "", stock_management: true, stock: "5" };

  it("normaliza os campos", () => {
    expect(variantEditSchema.parse({ ...base, sku: "  ", promotional_price: "79,9" })).toEqual({
      sku: null,
      price: "100.00",
      promotional_price: "79.90",
      stock_management: true,
      stock: 5,
    });
  });

  it("zera o estoque quando não há controle", () => {
    expect(variantEditSchema.parse({ ...base, stock_management: false, stock: "12" }).stock).toBeNull();
    expect(variantEditSchema.safeParse({ ...base, stock_management: false, stock: "" }).success).toBe(true);
  });

  it("valida preço, promocional e estoque", () => {
    const err = (over: object) => {
      const r = variantEditSchema.safeParse({ ...base, ...over });
      return r.success ? null : r.error.issues.map((i) => String(i.path[0]));
    };
    expect(err({ price: "" })).toEqual(["price"]);
    expect(err({ price: "0" })).toEqual(["price"]);
    expect(err({ promotional_price: "100,00" })).toEqual(["promotional_price"]);
    expect(err({ promotional_price: "120" })).toEqual(["promotional_price"]);
    expect(err({ stock: "" })).toEqual(["stock"]);
    expect(err({ stock: "-1" })).toEqual(["stock"]);
    expect(err({ stock: "1,5" })).toEqual(["stock"]);
  });
});

describe("diff de variante", () => {
  const before = variantToEdit({ sku: "A", price: "100.00", promotional_price: null, stock_management: true, stock: 5 });

  it("detecta só o que mudou, comparando preços como número", () => {
    expect(changedVariantFields(before, { ...before, price: "100.0" as string })).toEqual([]);
    expect(changedVariantFields(before, { ...before, price: "90.00", stock: 7 })).toEqual(["price", "stock"]);
    expect(changedVariantFields(before, { ...before, promotional_price: "80.00" })).toEqual(["promotional_price"]);
  });

  it("envia só o alterado; ao ligar o controle, a quantidade vai junto", () => {
    expect(buildVariantInput({ ...before, price: "90.00" }, ["price"])).toEqual({ price: "90.00" });
    const off = variantToEdit({ sku: "A", price: "100.00", stock_management: false });
    const on = { ...off, stock_management: true, stock: 3 };
    expect(buildVariantInput(on, changedVariantFields(off, on))).toEqual({ stock_management: true, stock: 3 });
    const turnedOff = { ...before, stock_management: false, stock: null };
    expect(buildVariantInput(turnedOff, changedVariantFields(before, turnedOff))).toEqual({ stock_management: false, stock: null });
  });
});

function variant(id: number, productId: number, over: Partial<Variant> = {}): Variant {
  return { id, product_id: productId, sku: `SKU-${id}`, price: "100.00", stock_management: true, stock: 5, values: [{ pt: "P" }], ...over };
}
function product(id: number, over: Partial<Product> = {}): Product {
  return {
    id,
    name: { pt: `Produto ${id}` },
    published: true,
    categories: [],
    images: [
      { id: 11, product_id: id, src: "https://cdn/a.jpg", position: 1 },
      { id: 12, product_id: id, src: "https://cdn/b.jpg", position: 2, alt: { pt: "Frente" } },
      { id: 13, product_id: id, src: "https://cdn/c.jpg", position: 3 },
    ],
    variants: [variant(100, id), variant(101, id, { sku: "SKU-101" })],
    updated_at: "2026-10-01T10:00:00+0000",
    ...over,
  };
}

const mirrorVariant = async (id: number) =>
  (await pg.query<{ sku: string | null; price: string; promotional_price: string | null; stock: number | null; stock_management: boolean }>(
    "SELECT sku, price::text AS price, promotional_price::text AS promotional_price, stock, stock_management FROM variants WHERE id = $1",
    [id],
  )).rows[0]!;
const audits = async () => (await pg.query("SELECT acao, entidade, entidade_id, sucesso, antes, depois FROM audit_log ORDER BY id")).rows as Array<Record<string, unknown>>;

describe("updateVariant", () => {
  beforeEach(async () => {
    await upsertProducts(db, storeId, [product(1)]);
  });
  const after = (over: Partial<ReturnType<typeof variantToEdit>>) => ({ ...variantToEdit(variant(100, 1)), ...over });

  it("envia só o alterado, atualiza o espelho e registra no histórico", async () => {
    const puts: unknown[] = [];
    const api: VariantApi = {
      get: async () => variant(100, 1),
      put: async (_p, _v, input) => {
        puts.push(input);
        return variant(100, 1, { price: "89.90", promotional_price: "79.90" });
      },
    };
    const r = await updateVariant(db, api, { storeId, actor, productId: 1, variantId: 100, after: after({ price: "89.90", promotional_price: "79.90" }) });
    expect(r).toEqual({ changed: true, fields: ["price", "promotional_price"] });
    expect(puts).toEqual([{ price: "89.90", promotional_price: "79.90" }]);
    expect(await mirrorVariant(100)).toMatchObject({ price: "89.90", promotional_price: "79.90" });
    expect(await audits()).toMatchObject([{ acao: "variante.atualizar", entidade: "variante", entidade_id: "100", sucesso: true, depois: { price: "89.90" } }]);
  });

  it("não chama a API quando nada mudou", async () => {
    const api: VariantApi = { get: async () => { throw new Error("não deveria"); }, put: async () => { throw new Error("não deveria"); } };
    expect(await updateVariant(db, api, { storeId, actor, productId: 1, variantId: 100, after: after({}) })).toEqual({ changed: false });
  });

  it("recusa e atualiza o espelho se a loja mudou a variante por fora", async () => {
    let put = false;
    const api: VariantApi = { get: async () => variant(100, 1, { stock: 99 }), put: async () => { put = true; return variant(100, 1); } };
    await expect(updateVariant(db, api, { storeId, actor, productId: 1, variantId: 100, after: after({ price: "50.00" }) })).rejects.toBeInstanceOf(VariantConflictError);
    expect(put).toBe(false);
    expect((await mirrorVariant(100)).stock).toBe(99);
  });

  it("registra a falha da API e mantém o espelho", async () => {
    const api: VariantApi = {
      get: async () => variant(100, 1),
      put: async () => { throw new NuvemshopError("422", 422, null, "sku duplicado"); },
    };
    await expect(updateVariant(db, api, { storeId, actor, productId: 1, variantId: 100, after: after({ sku: "DUP" }) })).rejects.toBeInstanceOf(NuvemshopError);
    expect((await mirrorVariant(100)).sku).toBe("SKU-100");
    expect(await audits()).toMatchObject([{ sucesso: false, depois: { sku: "DUP" } }]);
  });

  it("falha para variante inexistente no espelho", async () => {
    const api: VariantApi = { get: async () => variant(999, 1), put: async () => variant(999, 1) };
    await expect(updateVariant(db, api, { storeId, actor, productId: 1, variantId: 999, after: after({}) })).rejects.toBeInstanceOf(VariantNotFoundError);
  });
});

describe("imagens", () => {
  let remote: Product;
  let calls: string[];
  let api: ImageApi;

  beforeEach(async () => {
    remote = product(1);
    calls = [];
    await upsertProducts(db, storeId, [remote]);
    api = {
      getProduct: async () => structuredClone(remote),
      create: async (_p, input) => {
        calls.push(`create ${input.src}`);
        remote.images = [...(remote.images ?? []), { id: 14, product_id: 1, src: input.src, position: (remote.images?.length ?? 0) + 1 }];
        return remote.images[remote.images.length - 1] as ProductImage;
      },
      remove: async (_p, id) => {
        calls.push(`remove ${id}`);
        remote.images = (remote.images ?? []).filter((i) => i.id !== id);
      },
      setPosition: async (_p, id, position) => {
        calls.push(`move ${id} -> ${position}`);
        const imgs = [...(remote.images ?? [])];
        const idx = imgs.findIndex((i) => i.id === id);
        const [item] = imgs.splice(idx, 1);
        imgs.splice(position - 1, 0, item!);
        remote.images = imgs.map((i, n) => ({ ...i, position: n + 1 }));
        return item as ProductImage;
      },
    };
  });

  const ids = async () => (await getProductImages(db, storeId, 1)).map((i) => i.id);

  it("lista as imagens na ordem, com alt em pt", async () => {
    const list = await getProductImages(db, storeId, 1);
    expect(list.map((i) => [i.id, i.position, i.alt])).toEqual([["11", 1, ""], ["12", 2, "Frente"], ["13", 3, ""]]);
  });

  it("valida a URL (https obrigatório)", () => {
    expect(imageUrlSchema.safeParse("https://x.com/a.jpg").success).toBe(true);
    expect(imageUrlSchema.safeParse("http://x.com/a.jpg").success).toBe(false);
    expect(imageUrlSchema.safeParse("javascript:alert(1)").success).toBe(false);
    expect(imageUrlSchema.safeParse("não é url").success).toBe(false);
  });

  it("adiciona, atualiza o espelho (inclui image_count) e registra", async () => {
    await addImage(db, api, { storeId, actor, productId: 1, src: "https://cdn/novo.jpg" });
    expect(await ids()).toEqual(["11", "12", "13", "14"]);
    expect((await pg.query("SELECT image_count FROM products WHERE id = 1")).rows[0]).toEqual({ image_count: 4 });
    expect(await audits()).toMatchObject([{ acao: "imagem.adicionar", sucesso: true, depois: { src: "https://cdn/novo.jpg" } }]);
  });

  it("remove e reflete a loja", async () => {
    await removeImage(db, api, { storeId, actor, productId: 1, imageId: 12 });
    expect(calls).toEqual(["remove 12"]);
    expect(await ids()).toEqual(["11", "13"]);
  });

  it("move para cima e para baixo; nas pontas não faz nada", async () => {
    expect(await moveImage(db, api, { storeId, actor, productId: 1, imageId: 12, direction: -1 })).toBe(true);
    expect(await ids()).toEqual(["12", "11", "13"]);
    expect(await moveImage(db, api, { storeId, actor, productId: 1, imageId: 12, direction: -1 })).toBe(false);
    expect(await moveImage(db, api, { storeId, actor, productId: 1, imageId: 13, direction: 1 })).toBe(false);
    expect(calls).toEqual(["move 12 -> 1"]);
  });

  it("registra a falha da API e não mexe no espelho", async () => {
    api.create = async () => {
      throw new NuvemshopError("422", 422, null, "não foi possível baixar a imagem");
    };
    await expect(addImage(db, api, { storeId, actor, productId: 1, src: "https://cdn/x.jpg" })).rejects.toBeInstanceOf(NuvemshopError);
    expect(await ids()).toEqual(["11", "12", "13"]);
    expect(await audits()).toMatchObject([{ acao: "imagem.adicionar", sucesso: false }]);
  });
});
