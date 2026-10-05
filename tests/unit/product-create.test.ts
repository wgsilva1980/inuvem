import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import type { Db } from "@/lib/sync/repo";
import { MAX_VARIANTS, buildCreateInput, createProduct, gerarCombinacoes, InvalidNewProductError, parseCores, parseTamanhos, validateNewVariants, type CreateApi, type NewVariantInput } from "@/lib/catalog/create";
import { parseNewProductForm } from "@/lib/catalog/new-product-form";
import { getProductDetail, listCatalog } from "@/lib/catalog/query";
import { NuvemshopError } from "@/lib/nuvemshop/errors";
import type { Product, ProductInput } from "@/lib/nuvemshop/types";

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

describe("listas de cores e tamanhos", () => {
  it("separa por vírgula, ponto e vírgula ou linha, padroniza e tira repetidos", () => {
    expect(parseCores("preta, azul claro\nPRETA; Off  white")).toEqual(["Preta", "Azul Claro", "Off White"]);
    expect(parseTamanhos("pp, p; m\nGG, p, unico")).toEqual(["PP", "P", "M", "GG", "ÚNICO"]);
    expect(parseCores("  ,, \n ")).toEqual([]);
  });

  it("gera uma linha por cor, com cada tamanho dentro", () => {
    expect(gerarCombinacoes(["Preta", "Branca"], ["P", "M"])).toEqual([
      { cor: "Preta", tamanho: "P" },
      { cor: "Preta", tamanho: "M" },
      { cor: "Branca", tamanho: "P" },
      { cor: "Branca", tamanho: "M" },
    ]);
    expect(gerarCombinacoes([], ["P"])).toEqual([]);
  });
});

const variante = (over: Partial<NewVariantInput> = {}): NewVariantInput => ({ values: ["Preta", "P"], sku: null, price: "199.90", promotional_price: null, stock_management: false, stock: null, weight: null, ...over });
const produto = { name: "Blusa Nova", description: "<p>Linda</p>", tags: "blusa,verão", published: false, seo_title: "", seo_description: "", categories: [10, 20] };

describe("buildCreateInput", () => {
  it("variações: propriedades COR e TAMANHO e um valor de cada em cada variante", () => {
    const input = buildCreateInput(produto, [variante(), variante({ values: ["Preta", "M"], sku: "B-PM", stock_management: true, stock: 3, promotional_price: "149.90", weight: "0.250" })]);
    expect(input.attributes).toEqual([{ pt: "COR" }, { pt: "TAMANHO" }]);
    expect(input.name).toEqual({ pt: "Blusa Nova" });
    expect(input.published).toBe(false);
    expect(input.categories).toEqual([10, 20]);
    expect(input.tags).toBe("blusa,verão");
    expect(input.variants).toEqual([
      { price: "199.90", stock_management: false, values: [{ pt: "Preta" }, { pt: "P" }] },
      { price: "199.90", stock_management: true, promotional_price: "149.90", sku: "B-PM", stock: 3, weight: "0.250", values: [{ pt: "Preta" }, { pt: "M" }] },
    ]);
  });

  it("produto simples: sem propriedades nem valores, e sem campos vazios", () => {
    const input = buildCreateInput({ ...produto, tags: "", categories: [] }, [variante({ values: [] })]);
    expect(input.attributes).toBeUndefined();
    expect(input.tags).toBeUndefined();
    expect(input.categories).toBeUndefined();
    expect(input.seo_title).toBeUndefined();
    expect(input.variants).toEqual([{ price: "199.90", stock_management: false }]);
  });

  it("limpa o HTML da descrição (nada de script)", () => {
    const input = buildCreateInput({ ...produto, description: '<p onclick="x()">Oi</p><script>alert(1)</script>' }, [variante()]);
    expect(input.description).toEqual({ pt: "<p>Oi</p>" });
  });
});

describe("validateNewVariants", () => {
  it("aceita um produto simples ou uma grade sem repetição", () => {
    expect(validateNewVariants([variante({ values: [] })])).toBeNull();
    expect(validateNewVariants([variante(), variante({ values: ["Preta", "M"] })])).toBeNull();
  });
  it("recusa vazio, repetido (sem diferenciar caixa), mistura e excesso", () => {
    expect(validateNewVariants([])).toContain("ao menos uma cor e um tamanho");
    expect(validateNewVariants([variante(), variante({ values: ["PRETA", "p"] })])).toContain("mesma cor e o mesmo tamanho");
    expect(validateNewVariants([variante(), variante({ values: [] })])).toContain("Todas as variantes precisam");
    expect(validateNewVariants([variante({ values: [] }), variante({ values: [] })])).toContain("variante só");
    expect(validateNewVariants([variante({ values: ["Preta"] })])).toContain("a cor e o tamanho de cada variante");
    expect(validateNewVariants(Array.from({ length: MAX_VARIANTS + 1 }, (_, i) => variante({ values: [`Cor ${i}`, "P"] })))).toContain("máximo");
  });
});

function form(campos: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}

describe("parseNewProductForm", () => {
  const base = { name: " Blusa Nova ", description: "<p>x</p>", tags: " a , b ", seo_title: "", seo_description: "" };

  it("modo simples: uma variante, preço com vírgula, peso e estoque", () => {
    const r = parseNewProductForm(form({ ...base, modo: "simples", preco: "1.299,90", promocional: "999,9", sku: " S-1 ", controlar_estoque: "on", estoque: "4", peso: "0,3", categories: ["10", "x", "20"] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.product).toMatchObject({ name: "Blusa Nova", tags: "a,b", published: false, categories: [10, 20] });
    expect(r.variants).toEqual([{ values: [], sku: "S-1", price: "1299.90", promotional_price: "999.90", stock_management: true, stock: 4, weight: "0.300" }]);
  });

  it("modo variações: linhas com cor e tamanho padronizados, peso e controle de estoque para todas", () => {
    const r = parseNewProductForm(form({ ...base, modo: "variacoes", vcount: "2", peso_v: "0,25", controlar_estoque_v: "on", v_0_cor: "off white", v_0_tam: "p", v_0_preco: "199,90", v_0_estoque: "2", v_1_cor: "off white", v_1_tam: "unico", v_1_preco: "199,90", v_1_promo: "159,90", v_1_estoque: "0", v_1_sku: "OW-U" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.variants.map((v) => v.values)).toEqual([["Off White", "P"], ["Off White", "ÚNICO"]]);
    expect(r.variants[1]).toMatchObject({ sku: "OW-U", promotional_price: "159.90", stock: 0, stock_management: true, weight: "0.250" });
  });

  it("mostra o erro ao lado do campo certo (simples e variações)", () => {
    const simples = parseNewProductForm(form({ ...base, name: "", modo: "simples", preco: "abc", promocional: "9999", estoque: "x", controlar_estoque: "on", peso: "pesado" }));
    expect(simples.ok).toBe(false);
    if (simples.ok) return;
    expect(Object.keys(simples.fieldErrors).sort()).toEqual(["estoque", "name", "peso", "preco"]);

    const var1 = parseNewProductForm(form({ ...base, modo: "variacoes", vcount: "2", v_0_cor: "Preta", v_0_tam: "P", v_0_preco: "", v_1_cor: "Preta", v_1_tam: "M", v_1_preco: "10", v_1_promo: "20" }));
    expect(var1.ok).toBe(false);
    if (var1.ok) return;
    expect(var1.fieldErrors).toMatchObject({ v_0_preco: expect.any(String), v_1_promo: expect.stringContaining("menor") });
  });

  it("recusa grade vazia, repetida ou grande demais", () => {
    expect(parseNewProductForm(form({ ...base, modo: "variacoes", vcount: "0" }))).toMatchObject({ ok: false, message: expect.stringContaining("ao menos uma cor") });
    expect(parseNewProductForm(form({ ...base, modo: "variacoes", vcount: String(MAX_VARIANTS + 1) }))).toMatchObject({ ok: false });
    const repetida = parseNewProductForm(form({ ...base, modo: "variacoes", vcount: "2", v_0_cor: "Preta", v_0_tam: "P", v_0_preco: "10", v_1_cor: "PRETA", v_1_tam: "p", v_1_preco: "10" }));
    expect(repetida).toMatchObject({ ok: false, message: expect.stringContaining("mesma cor e o mesmo tamanho") });
  });

  it("novo produto nasce como rascunho a menos que 'Publicado' esteja marcado", () => {
    const campos = { ...base, modo: "simples", preco: "10" };
    expect(parseNewProductForm(form(campos))).toMatchObject({ ok: true, product: { published: false } });
    expect(parseNewProductForm(form({ ...campos, published: "on" }))).toMatchObject({ ok: true, product: { published: true } });
  });
});

/* ---- loja falsa ---- */
class FakeStore implements CreateApi {
  received: ProductInput[] = [];
  fail = false;
  dropVariants = false;
  async create(input: ProductInput): Promise<Product> {
    this.received.push(structuredClone(input));
    if (this.fail) throw new NuvemshopError("422", 422, null, "nome já usado");
    const variants = (input.variants ?? []).map((v, i) => ({ id: 9000 + i, product_id: 777, sku: (v.sku as string | null) ?? null, price: v.price, stock_management: v.stock_management ?? false, stock: (v.stock as number | undefined) ?? null, values: v.values ?? [] }));
    return {
      id: 777,
      name: input.name!,
      description: input.description,
      published: input.published,
      tags: input.tags,
      categories: (input.categories ?? []).map((id) => ({ id, name: { pt: `Cat ${id}` } })),
      attributes: input.attributes,
      variants: this.dropVariants ? variants.slice(0, 1) : variants,
      updated_at: "2026-10-05T10:00:00+0000",
    } as Product;
  }
}

const audits = async () => (await pg.query("SELECT acao, entidade, entidade_id, sucesso, depois, resultado_api FROM audit_log ORDER BY id")).rows as Array<Record<string, unknown>>;

describe("createProduct", () => {
  const dois = [variante(), variante({ values: ["Preta", "M"] })];

  it("cria na loja, grava o espelho e registra no histórico", async () => {
    const api = new FakeStore();
    const r = await createProduct(db, api, { storeId, actor, product: produto, variants: dois });
    expect(r).toEqual({ id: 777, avisos: [] });
    expect(api.received).toHaveLength(1);
    const detalhe = await getProductDetail(db, storeId, 777);
    expect(detalhe).toMatchObject({ name: "Blusa Nova", published: false, attributes: ["COR", "TAMANHO"] });
    expect(detalhe?.variants.map((v) => v.values.map((x) => x.pt))).toEqual([["Preta", "P"], ["Preta", "M"]]);
    expect((await listCatalog(db, storeId)).total).toBe(1);
    expect(await audits()).toMatchObject([{ acao: "produto.criar", entidade: "produto", entidade_id: "777", sucesso: true, depois: { nome: "Blusa Nova", publicado: false, variantes: 2, propriedades: "COR | TAMANHO" } }]);
  });

  it("não chama a loja se as variantes forem inválidas", async () => {
    const api = new FakeStore();
    await expect(createProduct(db, api, { storeId, actor, product: produto, variants: [] })).rejects.toBeInstanceOf(InvalidNewProductError);
    expect(api.received).toEqual([]);
    expect(await audits()).toEqual([]);
  });

  it("se a loja recusar, registra a falha e não grava nada no espelho", async () => {
    const api = new FakeStore();
    api.fail = true;
    await expect(createProduct(db, api, { storeId, actor, product: produto, variants: dois })).rejects.toBeInstanceOf(NuvemshopError);
    expect((await listCatalog(db, storeId)).total).toBe(0);
    expect(await audits()).toMatchObject([{ acao: "produto.criar", entidade_id: null, sucesso: false, resultado_api: { status: 422 } }]);
  });

  it("avisa se a loja devolver menos variantes do que foram enviadas (o produto foi criado)", async () => {
    const api = new FakeStore();
    api.dropVariants = true;
    const r = await createProduct(db, api, { storeId, actor, product: produto, variants: dois });
    expect(r.avisos).toEqual(["a loja criou 1 variantes em vez de 2"]);
  });
});
