import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import type { Db } from "@/lib/sync/repo";
import { buscarParaSimular, definirCustos, produtoParaSimular } from "@/lib/costs/repo";
import { SimuladorErro, numeroBR, simular, type EntradaSimulador } from "@/lib/costs/simulador";

const base: EntradaSimulador = { preco: 100, custo: 40, taxaPct: 5, impostoPct: 6, extra: 3 };

describe("simular", () => {
  it("lucro, margem, markup, equilíbrio e preço para a margem desejada", () => {
    const r = simular({ ...base, margemAlvoPct: 40 });
    expect(r.base).toMatchObject({ desconto: 0, preco: 100, receitaLiquida: 89, lucro: 46, margem: 46, markup: 115, vendasParaIgualar: null });
    expect(r.equilibrio).toBe(48.32); // (40 + 3) / (1 − 0,11), arredondado para cima ao centavo
    expect(r.precoMargemAlvo).toBe(87.76); // 43 / (1 − 0,51)
    expect(r.descontoMaximoSemPrejuizo).toBe(51.68);
  });

  it("promoção: preço, lucro, margem e quantas vezes mais vendas para ganhar o mesmo", () => {
    const c20 = simular(base).cenarios.find((c) => c.desconto === 20)!;
    expect(c20).toMatchObject({ preco: 80, receitaLiquida: 71.2, lucro: 28.2, margem: 35.25, markup: 70.5, vendasParaIgualar: 1.64 });
  });

  it("desconto que passa do equilíbrio vira prejuízo e não tem como igualar", () => {
    const c60 = simular(base, [60]).cenarios[0]!;
    expect(c60.lucro).toBe(-7.4); // 40 × 0,89 − 43
    expect(c60.vendasParaIgualar).toBeNull();
  });

  it("sem lucro no preço cheio não há o que igualar", () => {
    const r = simular({ preco: 50, custo: 60, taxaPct: 0, impostoPct: 0, extra: 0 });
    expect(r.base.lucro).toBe(-10);
    expect(r.base.margem).toBe(-20);
    expect(r.descontoMaximoSemPrejuizo).toBe(0);
    expect(r.cenarios.every((c) => c.vendasParaIgualar === null)).toBe(true);
  });

  it("custo zero não calcula markup", () => {
    expect(simular({ ...base, custo: 0 }).base.markup).toBeNull();
  });

  it("recusa valores impossíveis com mensagem clara", () => {
    const erro = (e: Partial<EntradaSimulador>) => () => simular({ ...base, ...e });
    expect(erro({ preco: 0 })).toThrow(SimuladorErro);
    expect(erro({ preco: Number.NaN })).toThrow(/números válidos/);
    expect(erro({ custo: -1 })).toThrow(/negativos/);
    expect(erro({ taxaPct: 60, impostoPct: 40 })).toThrow(/abaixo de 100%/);
    expect(erro({ margemAlvoPct: 90 })).toThrow(/margem desejada/);
  });
});

describe("numeroBR", () => {
  it("lê o jeito brasileiro e o ponto decimal", () => {
    expect(numeroBR("89,90")).toBe(89.9);
    expect(numeroBR("R$ 1.299,90")).toBe(1299.9);
    expect(numeroBR("1.299")).toBe(1299);
    expect(numeroBR("89.90")).toBe(89.9);
    expect(numeroBR("12,5%")).toBe(12.5);
    expect(numeroBR("")).toBeNull();
    expect(numeroBR(undefined)).toBeNull();
    expect(numeroBR("abc")).toBeNull();
  });
});

let pg: PGlite;
let db: Db;
let storeId: string;
beforeEach(async () => {
  pg = new PGlite();
  db = { query: async (text, params) => (await pg.query(text, params as never)).rows as never };
  await runMigrations({ exec: async (s) => void (await pg.exec(s)), query: async (s, p) => (await pg.query(s, p)).rows as never }, loadMigrations(join(process.cwd(), "db/migrations")));
  storeId = (await pg.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (1, 'x') RETURNING id")).rows[0]!.id;
  await pg.query("INSERT INTO products (store_id, id, name, published, raw_json) VALUES ($1, 1, 'Vestido Azul', true, '{}'::jsonb), ($1, 2, 'Saia 100% Linho', false, '{}'::jsonb)", [storeId]);
  await pg.query("INSERT INTO variants (store_id, id, product_id, sku, price, promotional_price, raw_json) VALUES ($1, 11, 1, 'VA-P', 120, 99.9, '{}'::jsonb), ($1, 12, 1, 'VA-M', 150, NULL, '{}'::jsonb), ($1, 21, 2, 'SL-U', 80, NULL, '{}'::jsonb)", [storeId]);
  await definirCustos(db, { storeId, actor: "a@b.com", origem: "manual", itens: [{ productId: "1", custo: 45.5 }] });
});

describe("produto para simular", () => {
  it("traz o menor preço cheio, a promoção em vigor e o custo cadastrado", async () => {
    expect(await produtoParaSimular(db, storeId, "1")).toEqual({ id: "1", nome: "Vestido Azul", publicado: true, preco: 120, precoPromocional: 99.9, custo: 45.5 });
    expect(await produtoParaSimular(db, storeId, "2")).toMatchObject({ preco: 80, precoPromocional: null, custo: null });
    expect(await produtoParaSimular(db, storeId, "99")).toBeNull();
    expect(await produtoParaSimular(db, storeId, "1; DROP TABLE products")).toBeNull();
  });

  it("busca por nome ou SKU, com caracteres especiais sem quebrar", async () => {
    expect((await buscarParaSimular(db, storeId, "vestido")).map((p) => p.id)).toEqual(["1"]);
    expect((await buscarParaSimular(db, storeId, "sl-u")).map((p) => p.id)).toEqual(["2"]);
    expect((await buscarParaSimular(db, storeId, "100%")).map((p) => p.id)).toEqual(["2"]);
    expect(await buscarParaSimular(db, storeId, "%")).toHaveLength(1); // o % é literal, não coringa
    expect(await buscarParaSimular(db, storeId, "inexistente")).toEqual([]);
  });
});
