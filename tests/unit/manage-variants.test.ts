import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import { upsertProducts, type Db } from "@/lib/sync/repo";
import { getProductDetail } from "@/lib/catalog/query";
import {
  AttributesConflictError,
  InvalidAttributesError,
  LastVariantError,
  createNewVariant,
  deleteProductVariant,
  renameAttributes,
  type ManageApi,
} from "@/lib/catalog/manage-variants";
import { DuplicateVariantError, InvalidVariantValuesError, VariantNotFoundError, updateVariant, type VariantApi } from "@/lib/catalog/update-variant";
import { buildVariantInput, changedVariantFields, formValues, parseWeight, variantEditSchema, variantToEdit } from "@/lib/catalog/variants";
import { NuvemshopError } from "@/lib/nuvemshop/errors";
import type { Product, Variant } from "@/lib/nuvemshop/types";

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

function variant(id: number, values: Array<Record<string, string>>, over: Partial<Variant> = {}): Variant {
  return { id, product_id: 1, sku: `SKU-${id}`, price: "100.00", stock_management: true, stock: 5, weight: "0.229", values, ...over };
}
const baseProduct = (over: Partial<Product> = {}): Product => ({
  id: 1,
  name: { pt: "Blusa" },
  published: true,
  categories: [],
  attributes: [{ pt: "Cor" }, { pt: "Tam" }],
  variants: [variant(100, [{ pt: "Branca" }, { pt: "PP" }]), variant(101, [{ pt: "Branca" }, { pt: "P" }])],
  updated_at: "2026-10-01T10:00:00+0000",
  ...over,
});

const audits = async () => (await pg.query("SELECT acao, entidade, entidade_id, sucesso, antes, depois, resultado_api FROM audit_log ORDER BY id")).rows as Array<Record<string, unknown>>;
const mirrorValues = async () =>
  (await pg.query<{ id: string; values: Array<Record<string, string>> }>("SELECT id::text AS id, values FROM variants ORDER BY id")).rows.map((r) => [r.id, r.values.map((v) => v.pt)]);

describe("peso e valores no formulário de variante", () => {
  it.each([
    ["0,229", "0.229"],
    ["0.229", "0.229"],
    ["1", "1.000"],
    ["", null],
    ["abc", undefined],
    ["0,2299", undefined],
    ["-1", undefined],
  ])("parseWeight(%j) -> %j", (input, expected) => {
    expect(parseWeight(input)).toBe(expected);
  });

  const base = { sku: "", price: "10,00", promotional_price: "", stock_management: false, stock: "", image_id: "" };

  it("aceita peso e valores; sem eles, não edita (campos ausentes)", () => {
    expect(variantEditSchema.parse({ ...base, weight: "0,5", values: [" Azul ", "M"] })).toMatchObject({ weight: "0.500", values: ["Azul", "M"] });
    const sem = variantEditSchema.parse(base);
    expect(sem.weight).toBeUndefined();
    expect(sem.values).toBeUndefined();
  });

  it("recusa valor vazio ou peso inválido", () => {
    expect(variantEditSchema.safeParse({ ...base, values: ["Azul", "  "] }).success).toBe(false);
    expect(variantEditSchema.safeParse({ ...base, weight: "pesado" }).success).toBe(false);
  });

  it("detecta mudança de peso e de valores, e ignora o que não foi enviado", () => {
    const before = variantToEdit(variant(100, [{ pt: "Branca" }, { pt: "PP" }]));
    expect(before).toMatchObject({ weight: "0.229", values: ["Branca", "PP"] });
    expect(changedVariantFields(before, { ...before, weight: "0.2290" })).toEqual([]);
    expect(changedVariantFields(before, { ...before, weight: "0.300" })).toEqual(["weight"]);
    expect(changedVariantFields(before, { ...before, weight: null })).toEqual(["weight"]);
    expect(changedVariantFields(before, { ...before, values: ["Branca", "G"] })).toEqual(["values"]);
    expect(changedVariantFields(before, { ...before, weight: undefined, values: undefined })).toEqual([]);
  });

  it("monta os valores preservando outros idiomas da loja", () => {
    const before = variantToEdit(variant(100, [{ pt: "Branca", es: "Blanca" }, { pt: "PP" }]));
    const after = { ...before, values: ["Off White", "PP"] };
    const input = buildVariantInput(after, changedVariantFields(before, after), [{ pt: "Branca", es: "Blanca" }, { pt: "PP" }]);
    expect(input).toEqual({ values: [{ pt: "Off White", es: "Blanca" }, { pt: "PP" }] });
  });

  it("lê os campos value_N do formulário na ordem certa", () => {
    const fd = new FormData();
    fd.set("value_1", "PP");
    fd.set("value_0", "Branca");
    fd.set("sku", "x");
    expect(formValues(fd)).toEqual(["Branca", "PP"]);
    expect(formValues(new FormData())).toBeUndefined();
  });
});

describe("updateVariant com valores e peso", () => {
  beforeEach(async () => {
    await upsertProducts(db, storeId, [baseProduct()]);
  });
  const after = (over: Partial<ReturnType<typeof variantToEdit>>) => ({ ...variantToEdit(baseProduct().variants![0]!), ...over });
  const apiFor = (puts: unknown[], result: Variant): VariantApi => ({
    get: async () => baseProduct().variants![0]!,
    put: async (_p, _v, input) => {
      puts.push(input);
      return result;
    },
  });

  it("renomeia os valores e atualiza o peso, enviando só isso", async () => {
    const puts: unknown[] = [];
    const result = variant(100, [{ pt: "Off White" }, { pt: "PP" }], { weight: "0.300" });
    const r = await updateVariant(db, apiFor(puts, result), { storeId, actor, productId: 1, variantId: 100, after: after({ values: ["Off White", "PP"], weight: "0.300" }) });
    expect(r).toEqual({ changed: true, fields: ["weight", "values"] });
    expect(puts).toEqual([{ weight: "0.300", values: [{ pt: "Off White" }, { pt: "PP" }] }]);
    expect(await mirrorValues()).toEqual([["100", ["Off White", "PP"]], ["101", ["Branca", "P"]]]);
  });

  it("recusa quantidade de valores diferente da de propriedades, sem chamar a API", async () => {
    const never: VariantApi = { get: async () => { throw new Error("não deveria"); }, put: async () => { throw new Error("não deveria"); } };
    await expect(updateVariant(db, never, { storeId, actor, productId: 1, variantId: 100, after: after({ values: ["Branca"] }) })).rejects.toBeInstanceOf(InvalidVariantValuesError);
  });

  it("recusa combinação que já existe em outra variante (sem diferenciar maiúsculas)", async () => {
    const never: VariantApi = { get: async () => { throw new Error("não deveria"); }, put: async () => { throw new Error("não deveria"); } };
    await expect(updateVariant(db, never, { storeId, actor, productId: 1, variantId: 100, after: after({ values: ["BRANCA", "p"] }) })).rejects.toBeInstanceOf(DuplicateVariantError);
  });
});

describe("criar variante", () => {
  let remote: Product;
  let creates: unknown[];
  let api: ManageApi;
  beforeEach(async () => {
    remote = baseProduct();
    creates = [];
    await upsertProducts(db, storeId, [remote]);
    api = {
      getProduct: async () => structuredClone(remote),
      createVariant: async (_p, input) => {
        creates.push(input);
        const created = variant(102, (input.values ?? []) as Array<Record<string, string>>, { sku: (input.sku as string) ?? null, price: input.price as string });
        remote.variants = [...(remote.variants ?? []), created];
        return created;
      },
      deleteVariant: async (_p, id) => {
        remote.variants = (remote.variants ?? []).filter((v) => v.id !== id);
      },
      updateProduct: async (_p, input) => {
        remote.attributes = input.attributes;
        return structuredClone(remote);
      },
    };
  });
  const novo = { sku: "SKU-102", price: "120.00", promotional_price: null, stock_management: true, stock: 4, weight: "0.250", values: ["Preta", "M"] };

  it("cria na loja, regrava o espelho e registra no histórico", async () => {
    await createNewVariant(db, api, { storeId, actor, productId: 1, variant: novo });
    expect(creates).toEqual([
      { values: [{ pt: "Preta" }, { pt: "M" }], price: "120.00", stock_management: true, sku: "SKU-102", stock: 4, weight: "0.250" },
    ]);
    expect(await mirrorValues()).toEqual([["100", ["Branca", "PP"]], ["101", ["Branca", "P"]], ["102", ["Preta", "M"]]]);
    expect(await audits()).toMatchObject([{ acao: "variante.criar", entidade: "produto", entidade_id: "1", sucesso: true, antes: { total: 2 }, depois: { values: ["Preta", "M"], price: "120.00" } }]);
  });

  it("não manda campos vazios (sku, promocional, peso, estoque sem controle)", async () => {
    await createNewVariant(db, api, { storeId, actor, productId: 1, variant: { ...novo, sku: null, weight: null, stock_management: false, stock: null } });
    expect(creates).toEqual([{ values: [{ pt: "Preta" }, { pt: "M" }], price: "120.00", stock_management: false }]);
  });

  it("recusa combinação repetida e quantidade errada de valores, sem chamar a API", async () => {
    await expect(createNewVariant(db, api, { storeId, actor, productId: 1, variant: { ...novo, values: ["branca", "pp"] } })).rejects.toBeInstanceOf(DuplicateVariantError);
    await expect(createNewVariant(db, api, { storeId, actor, productId: 1, variant: { ...novo, values: ["Preta"] } })).rejects.toBeInstanceOf(InvalidVariantValuesError);
    expect(creates).toEqual([]);
    expect(await audits()).toEqual([]);
  });

  it("produto sem propriedades não aceita variante nova", async () => {
    await upsertProducts(db, storeId, [{ ...baseProduct({ id: 2, name: { pt: "Simples" }, attributes: [], variants: [variant(200, [], { product_id: 2 })] }) }]);
    await expect(createNewVariant(db, api, { storeId, actor, productId: 2, variant: { ...novo, values: [] } })).rejects.toBeInstanceOf(InvalidVariantValuesError);
  });

  it("registra a falha da API e não mexe no espelho", async () => {
    api.createVariant = async () => {
      throw new NuvemshopError("422", 422, null, "valores inválidos");
    };
    await expect(createNewVariant(db, api, { storeId, actor, productId: 1, variant: novo })).rejects.toBeInstanceOf(NuvemshopError);
    expect(await mirrorValues()).toEqual([["100", ["Branca", "PP"]], ["101", ["Branca", "P"]]]);
    expect(await audits()).toMatchObject([{ acao: "variante.criar", sucesso: false }]);
  });

  describe("excluir variante", () => {
    it("exclui na loja, tira do espelho e registra o que foi excluído", async () => {
      await deleteProductVariant(db, api, { storeId, actor, productId: 1, variantId: 101 });
      expect(await mirrorValues()).toEqual([["100", ["Branca", "PP"]]]);
      expect(await audits()).toMatchObject([{ acao: "variante.apagar", entidade_id: "1", sucesso: true, antes: { id: 101, values: ["Branca", "P"], sku: "SKU-101" }, depois: { total: 1 } }]);
    });

    it("não deixa excluir a última variante nem uma que não existe", async () => {
      await deleteProductVariant(db, api, { storeId, actor, productId: 1, variantId: 101 });
      await expect(deleteProductVariant(db, api, { storeId, actor, productId: 1, variantId: 100 })).rejects.toBeInstanceOf(LastVariantError);
      await expect(deleteProductVariant(db, api, { storeId, actor, productId: 1, variantId: 999 })).rejects.toBeInstanceOf(VariantNotFoundError);
    });

    it("registra a falha da API e mantém a variante no espelho", async () => {
      api.deleteVariant = async () => {
        throw new NuvemshopError("404", 404, null, "não encontrada");
      };
      await expect(deleteProductVariant(db, api, { storeId, actor, productId: 1, variantId: 101 })).rejects.toBeInstanceOf(NuvemshopError);
      expect(await mirrorValues()).toHaveLength(2);
      expect(await audits()).toMatchObject([{ acao: "variante.apagar", sucesso: false }]);
    });
  });

  describe("renomear propriedades", () => {
    it("envia os novos nomes (preservando outros idiomas), regrava o espelho e registra", async () => {
      remote.attributes = [{ pt: "Cor", es: "Color" }, { pt: "Tam" }];
      await upsertProducts(db, storeId, [structuredClone(remote)]);
      const sent: unknown[] = [];
      const original = api.updateProduct;
      api.updateProduct = async (p, input) => {
        sent.push(input);
        return original(p, input);
      };
      const r = await renameAttributes(db, api, { storeId, actor, productId: 1, names: ["Tom", " Tamanho "] });
      expect(r).toEqual({ changed: true });
      expect(sent).toEqual([{ attributes: [{ pt: "Tom", es: "Color" }, { pt: "Tamanho" }] }]);
      expect((await getProductDetail(db, storeId, 1))?.attributes).toEqual(["Tom", "Tamanho"]);
      expect(await audits()).toMatchObject([{ acao: "produto.propriedades", sucesso: true, antes: { propriedades: ["Cor", "Tam"] }, depois: { propriedades: ["Tom", "Tamanho"] } }]);
    });

    it("sem mudança não chama a API", async () => {
      api.getProduct = async () => { throw new Error("não deveria"); };
      expect(await renameAttributes(db, api, { storeId, actor, productId: 1, names: ["Cor", "Tam"] })).toEqual({ changed: false });
    });

    it("valida quantidade, vazios e nomes repetidos", async () => {
      await expect(renameAttributes(db, api, { storeId, actor, productId: 1, names: ["Cor"] })).rejects.toBeInstanceOf(InvalidAttributesError);
      await expect(renameAttributes(db, api, { storeId, actor, productId: 1, names: ["Cor", "  "] })).rejects.toBeInstanceOf(InvalidAttributesError);
      await expect(renameAttributes(db, api, { storeId, actor, productId: 1, names: ["Cor", "cor"] })).rejects.toBeInstanceOf(InvalidAttributesError);
      expect(await audits()).toEqual([]);
    });

    it("se a loja mudou as propriedades por fora, atualiza o espelho e pede para revisar", async () => {
      remote.attributes = [{ pt: "Cor" }, { pt: "Numeração" }];
      await expect(renameAttributes(db, api, { storeId, actor, productId: 1, names: ["Cor", "Tamanho"] })).rejects.toBeInstanceOf(AttributesConflictError);
      expect((await getProductDetail(db, storeId, 1))?.attributes).toEqual(["Cor", "Numeração"]);
    });
  });
});

describe("getProductDetail", () => {
  it("traz os nomes das propriedades e o peso das variantes", async () => {
    await upsertProducts(db, storeId, [baseProduct()]);
    const d = await getProductDetail(db, storeId, 1);
    expect(d?.attributes).toEqual(["Cor", "Tam"]);
    expect(d?.variants.map((v) => v.weight)).toEqual(["0.229", "0.229"]);
  });
});
