import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import { upsertCategories, upsertProducts, type Db } from "@/lib/sync/repo";
import { descontoBase, listarParados, type Parado } from "@/lib/promotions/parados";
import { ajustarPercentual, criarSugeridor, sugestaoPorRegra } from "@/lib/promotions/sugestao";
import { planoDaPromocao, resumoPercentuais } from "@/lib/promotions/plan";
import { avancarPromocao } from "@/lib/promotions/engine";
import { createPromotion, getPromotion } from "@/lib/promotions/repo";
import { loadMirrorProducts } from "@/lib/bulk/repo";
import { operationSchema } from "@/lib/bulk/operations";
import type { BulkApi } from "@/lib/bulk/engine";
import type { Category, Product, ProductInput, Variant, VariantInput } from "@/lib/nuvemshop/types";

let pg: PGlite;
let db: Db;
let storeId: string;
const actor = "admin@example.com";
const dia = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

beforeEach(async () => {
  pg = new PGlite();
  db = { query: async (text, params) => (await pg.query(text, params as never)).rows as never };
  await runMigrations(
    { exec: async (s) => void (await pg.exec(s)), query: async (s, p) => (await pg.query(s, p)).rows as never },
    loadMigrations(join(process.cwd(), "db/migrations")),
  );
  storeId = ((await pg.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (1, 'x') RETURNING id")).rows[0] as { id: string }).id;
});

/** Semeia o resumo de vendas por produto (o que a sincronização de pedidos grava). */
async function semearVendas(linhas: Array<{ product_id: number; units: number; orders: number; last_sold_at: string | null }>) {
  for (const l of linhas) {
    await pg.query("INSERT INTO product_sales (store_id, product_id, units, orders, last_sold_at, run_id) VALUES ($1, $2, $3, $4, $5, gen_random_uuid())", [storeId, l.product_id, l.units, l.orders, l.last_sold_at]);
  }
}

const variant = (id: number, productId: number, over: Partial<Variant> = {}): Variant => ({ id, product_id: productId, sku: `S${id}`, price: "100.00", stock_management: true, stock: 5, values: [{ pt: `V${id}` }], ...over });
const product = (id: number, over: Record<string, unknown> = {}): Product =>
  ({ id, name: { pt: `Produto ${id}` }, published: true, categories: [{ id: 1, name: { pt: "Cat" } }], variants: [variant(id * 10, id)], created_at: dia(400), updated_at: dia(1), ...over }) as unknown as Product;

async function catalogo(list: Product[]) {
  await upsertCategories(db, storeId, [{ id: 1, name: { pt: "Cat" } }] as Category[]);
  await upsertProducts(db, storeId, list);
}
const filtro = { dias: 90, minEstoque: 1, apenasPublicados: true, janelaDias: 365, limit: 100 };

describe("listarParados", () => {
  it("lista quem tem estoque e não vende há tempo, do maior dinheiro parado para o menor", async () => {
    await catalogo([
      product(1), // nunca vendeu, 5 x 100 = 500
      product(2, { variants: [variant(20, 2, { price: "200.00", stock: 5 })] }), // 1000 parados
      product(3), // vendeu há 10 dias: fora
      product(4, { variants: [variant(40, 4, { stock: 0 })] }), // sem estoque: fora
      product(5, { created_at: dia(10) }), // novo: fora
      product(6, { published: false }), // não publicado: fora (filtro padrão)
      product(7, { variants: [variant(70, 7, { stock_management: false, stock: null })] }), // estoque ilimitado: fora
      product(8), // vendeu há 200 dias: dentro
    ]);
    await semearVendas([
      { product_id: 3, units: 4, orders: 2, last_sold_at: dia(10) },
      { product_id: 8, units: 1, orders: 1, last_sold_at: dia(200) },
    ]);
    const r = await listarParados(db, storeId, filtro);
    expect(r.itens.map((i) => i.id)).toEqual(["2", "1", "8"]);
    expect(r.itens[0]).toMatchObject({ estoque: 5, valorParado: 1000, vendidas: 0, jaEmPromocao: false });
    expect(r.itens[2]).toMatchObject({ vendidas: 1 });
    expect(r.itens[2]!.diasParado).toBeGreaterThanOrEqual(199);
    expect(r.itens[1]!.diasParado).toBe(365); // nunca vendeu: limitado à janela
    expect((await listarParados(db, storeId, { ...filtro, apenasPublicados: false })).itens.map((i) => i.id)).toContain("6");
    expect((await listarParados(db, storeId, { ...filtro, minEstoque: 6 })).itens).toHaveLength(0);
  });

  it("deixa de fora quem já está numa promoção que não terminou", async () => {
    await catalogo([product(1), product(2)]);
    await createPromotion(db, {
      storeId,
      actor,
      nome: "Outra",
      operation: operationSchema.parse({ type: "promocao", mode: "desconto", percent: 10, rounding: "nenhum" }),
      productIds: [1],
      inicioLocal: "2099-01-01T09:00",
      fimLocal: "2099-01-02T09:00",
    });
    expect((await listarParados(db, storeId, filtro)).itens.map((i) => i.id)).toEqual(["2"]);
  });
});

describe("descontos sugeridos", () => {
  const parado = (over: Partial<Parado> = {}): Parado => ({ id: "1", name: "A", published: true, estoque: 5, precoMin: 100, precoMax: 100, jaEmPromocao: false, vendidas: 0, ultimaVenda: null, criadoEm: null, diasParado: 100, valorParado: 500, ...over });

  it("desconto de partida cresce com o tempo parado e fica entre 10% e 60%", () => {
    expect(descontoBase(parado({ diasParado: 100 }))).toBe(20);
    expect(descontoBase(parado({ diasParado: 365 }))).toBe(40);
    expect(descontoBase(parado({ diasParado: 365, estoque: 30, jaEmPromocao: true }))).toBe(50);
    expect(descontoBase(parado({ diasParado: 10 }))).toBe(15);
    expect(ajustarPercentual(67)).toBe(60);
    expect(ajustarPercentual(3)).toBe(10);
    expect(ajustarPercentual(22)).toBe(20);
    expect(sugestaoPorRegra(parado()).motivo).toMatch(/100 dias/);
  });

  it("usa a sugestão do Claude quando é razoável e a regra quando não é (ou faltou)", async () => {
    const itens = [parado({ id: "1" }), parado({ id: "2" }), parado({ id: "3" })];
    const pedidos: Array<Record<string, any>> = [];
    const resposta = { sugestoes: [{ id: "1", percent: 25, motivo: "Parado há 100 dias." }, { id: "2", percent: 60, motivo: "Exagero." }] };
    const c = { beta: { messages: { create: async (p: Record<string, any>) => (pedidos.push(p), { stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: JSON.stringify(resposta) }] }) } } } as never;
    const out = await criarSugeridor(c)(itens);
    expect(out.find((s) => s.id === "1")).toMatchObject({ percent: 25, motivo: "Parado há 100 dias." });
    expect(out.find((s) => s.id === "2")!.percent).toBe(20); // 60 está a 40 pontos da base: regra
    expect(out.find((s) => s.id === "3")!.percent).toBe(20); // faltou
    expect(pedidos).toHaveLength(1);
    expect(JSON.parse(pedidos[0]!.messages[0].content[0].text)[0]).toMatchObject({ id: "1", desconto_base: 20, estoque: 5 });
  });
});

describe("promoção com desconto por produto", () => {
  class Loja implements BulkApi {
    products = new Map<number, Product>();
    constructor(list: Product[]) {
      for (const p of list) this.products.set(p.id, structuredClone(p));
    }
    async getProduct(id: number) {
      return structuredClone(this.products.get(id)!);
    }
    async updateProduct(id: number, _i: ProductInput) {
      return structuredClone(this.products.get(id)!);
    }
    async deleteProduct(id: number) {
      this.products.delete(id);
    }
    async updateVariant(pid: number, vid: number, input: VariantInput) {
      const v = this.products.get(pid)!.variants!.find((x) => x.id === vid)!;
      Object.assign(v, input);
      return structuredClone(v);
    }
  }
  const op = operationSchema.parse({ type: "promocao", mode: "desconto", percent: 20, rounding: "nenhum" });

  it("monta o plano com o percentual de cada produto", async () => {
    await catalogo([product(1), product(2), product(3)]);
    const mirror = await loadMirrorProducts(db, storeId, [1, 2, 3]);
    const plano = planoDaPromocao(op, { "1": 10, "2": 30 }, mirror);
    const depois = (id: number) => plano.items.find((i) => i.productId === id)!.changes.variants[0]!.promotional_price!.depois;
    expect([depois(1), depois(2), depois(3)]).toEqual(["90.00", "70.00", "80.00"]); // o 3 usa o percentual da operação
    expect(plano.items.map((i) => i.productId)).toEqual([1, 2, 3]);
    expect(resumoPercentuais(op, { "1": 10, "2": 30 })).toBe("de 10% a 30%");
    expect(resumoPercentuais(op, { "1": 15 })).toBe("15%");
  });

  it("aplica e restaura com desconto próprio, e valida os percentuais", async () => {
    await catalogo([product(1), product(2)]);
    const loja = new Loja([product(1), product(2)]);
    await expect(createPromotion(db, { storeId, actor, nome: "X", operation: op, productIds: [1], percents: { "9": 10 }, inicioLocal: "2099-01-01T09:00", fimLocal: "2099-01-02T09:00" })).rejects.toThrow(/fora da seleção/);
    await expect(createPromotion(db, { storeId, actor, nome: "X", operation: op, productIds: [1], percents: { "1": 100 }, inicioLocal: "2099-01-01T09:00", fimLocal: "2099-01-02T09:00" })).rejects.toThrow(/maior que 0%/);
    const id = await createPromotion(db, { storeId, actor, nome: "Liquida", operation: op, productIds: [1, 2], percents: { "1": 10, "2": 40 }, inicioLocal: "2099-01-01T09:00", fimLocal: "2099-01-02T09:00" });
    expect((await getPromotion(db, storeId, id))!.percents).toEqual({ "1": 10, "2": 40 });

    const andar = async (acao?: "iniciar" | "encerrar") => {
      let r = await avancarPromocao(db, loja, { storeId, actor, id, acao, budgetMs: 10_000 });
      for (let i = 0; i < 20 && !r.done; i++) r = await avancarPromocao(db, loja, { storeId, actor, id, budgetMs: 10_000 });
      return r;
    };
    expect((await andar("iniciar")).status).toBe("ativa");
    const promo = (pid: number) => loja.products.get(pid)!.variants![0]!.promotional_price ?? null;
    expect([promo(1), promo(2)]).toEqual(["90.00", "60.00"]);
    expect((await andar("encerrar")).status).toBe("encerrada");
    expect([promo(1), promo(2)]).toEqual([null, null]);
  });
});
