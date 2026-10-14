import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import { FornecedorInvalidoError, definirFornecedor, fornecedorDoProduto, listarFornecedores } from "@/lib/catalog/fornecedor";
import { getProductDetail } from "@/lib/catalog/query";
import { updateVariant, type VariantApi } from "@/lib/catalog/update-variant";
import { buildVariantInput, changedVariantFields, variantEditSchema, variantFormInput, variantToEdit } from "@/lib/catalog/variants";
import { gravarCustoDaVariacao, sincronizarCustoDoProduto } from "@/lib/costs/variante";
import { NuvemshopError } from "@/lib/nuvemshop/errors";
import type { Product, Variant, VariantInput } from "@/lib/nuvemshop/types";
import { upsertProducts, type Db } from "@/lib/sync/repo";

let pg: PGlite;
let db: Db;
let storeId: string;
const actor = "dono@exemplo.com";

beforeEach(async () => {
  pg = new PGlite();
  db = { query: async (text, params) => (await pg.query(text, params as never)).rows as never };
  await runMigrations({ exec: async (s) => void (await pg.exec(s)), query: async (s, p) => (await pg.query(s, p)).rows as never }, loadMigrations(join(process.cwd(), "db/migrations")));
  storeId = ((await pg.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (1, 'x') RETURNING id")).rows[0] as { id: string }).id;
});

const variante = (id: number, over: Record<string, unknown> = {}) => ({ id, product_id: 1, sku: `S${id}`, price: "100.00", stock_management: false, stock: null, values: [{ pt: "P" }], ...over });
const produto = (variantes: Array<Record<string, unknown>>): Product => ({ id: 1, name: { pt: "Bolsa" }, published: true, categories: [], variants: variantes, attributes: [{ pt: "Tam" }], updated_at: "2026-10-01T10:00:00+0000" }) as unknown as Product;

describe("campo de custo da variação (formulário e esquema)", () => {
  const base = { sku: "", price: "100,00", promotional_price: "", stock_management: false, stock: "", image_id: "" };
  it("lê R$ em vários formatos; zero e vazio viram 'sem custo'; ausente não é edição", () => {
    expect(variantEditSchema.parse({ ...base, cost: "45,90" }).cost).toBe("45.90");
    expect(variantEditSchema.parse({ ...base, cost: "1.234,50" }).cost).toBe("1234.50");
    expect(variantEditSchema.parse({ ...base, cost: "" }).cost).toBeNull();
    expect(variantEditSchema.parse({ ...base, cost: "0,00" }).cost).toBeNull();
    expect("cost" in variantEditSchema.parse(base)).toBe(false);
    expect(variantEditSchema.safeParse({ ...base, cost: "abc" }).success).toBe(false);
  });
  it("variantFormInput só lê o custo se o campo está no formulário", () => {
    const f = new FormData();
    f.append("v7_price", "10");
    expect(variantFormInput(f, 7).cost).toBeUndefined();
    f.append("v7_cost", "5,5");
    expect(variantFormInput(f, 7).cost).toBe("5,5");
  });
  it("mudança de custo aparece nos campos alterados e vai no corpo da loja", () => {
    const antes = variantToEdit({ price: "100", cost: "40.00" });
    const depois = variantEditSchema.parse({ ...base, cost: "45,00" });
    const campos = changedVariantFields(antes, depois);
    expect(campos).toEqual(["cost"]);
    expect(buildVariantInput(depois, campos)).toEqual({ cost: "45.00" });
    expect(changedVariantFields(antes, variantEditSchema.parse({ ...base, cost: "40" }))).toEqual([]);
  });
});

describe("salvar o custo da variação", () => {
  const edicao = (cost: string) => variantEditSchema.parse({ sku: "S10", price: "100,00", promotional_price: "", stock_management: false, stock: "", image_id: "", cost });
  async function semear(extra: Record<string, unknown> = {}) {
    await upsertProducts(db, storeId, [produto([variante(10, extra)])]);
  }
  function lojaFalsa(opcoes: { ignoraCusto?: boolean; recusaCusto?: boolean } = {}) {
    const estado: Record<string, unknown> = { ...variante(10) };
    const puts: VariantInput[] = [];
    const api: VariantApi = {
      get: async () => ({ ...estado }) as unknown as Variant,
      put: async (_p, _v, input) => {
        puts.push(input);
        if (opcoes.recusaCusto && "cost" in input) throw new NuvemshopError("422", 422, null, "cost não permitido");
        const { cost, ...resto } = input;
        Object.assign(estado, resto, opcoes.ignoraCusto ? {} : cost === undefined ? {} : { cost });
        return { ...estado } as unknown as Variant;
      },
    };
    return { api, puts, estado };
  }
  const custoPainel = async () => (await pg.query<{ cost: string }>("SELECT cost::text FROM variant_costs WHERE variant_id = 10")).rows[0]?.cost ?? null;

  it("grava no painel e envia à loja (a loja devolve o custo): sem aviso, e a edição mostra o custo", async () => {
    await semear();
    const l = lojaFalsa();
    const r = await updateVariant(db, l.api, { storeId, actor, productId: 1, variantId: 10, after: edicao("45,90") });
    expect(r).toEqual({ changed: true, fields: ["cost"] });
    expect(l.puts).toEqual([{ cost: "45.90" }]);
    expect(await custoPainel()).toBe("45.90");
    expect((await getProductDetail(db, storeId, 1))!.variants[0]!.cost).toBe("45.90");
    const [log] = (await pg.query<{ acao: string; sucesso: boolean; depois: unknown }>("SELECT acao, sucesso, depois FROM audit_log")).rows;
    expect(log).toMatchObject({ acao: "variante.atualizar", sucesso: true, depois: { cost: "45.90" } });
  });

  it("loja que ignora o campo: o custo fica no painel, com aviso, e não vira 'alterada por fora' na próxima vez", async () => {
    await semear();
    const l = lojaFalsa({ ignoraCusto: true });
    const r = await updateVariant(db, l.api, { storeId, actor, productId: 1, variantId: 10, after: edicao("45,90") });
    expect(r).toMatchObject({ changed: true, avisos: [expect.stringContaining("não gravou o preço de custo")] });
    expect(await custoPainel()).toBe("45.90");
    // segunda edição (outro campo): o custo do painel difere do da loja, mas isso não é conflito
    const depois = variantEditSchema.parse({ sku: "S10", price: "110,00", promotional_price: "", stock_management: false, stock: "", image_id: "", cost: "45,90" });
    const r2 = await updateVariant(db, l.api, { storeId, actor, productId: 1, variantId: 10, after: depois });
    expect(r2).toMatchObject({ changed: true, fields: ["price"] });
  });

  it("loja que recusa o pacote por causa do custo: grava o resto sem ele e guarda o custo no painel", async () => {
    await semear();
    const l = lojaFalsa({ recusaCusto: true });
    const depois = variantEditSchema.parse({ sku: "S10", price: "120,00", promotional_price: "", stock_management: false, stock: "", image_id: "", cost: "30" });
    const r = await updateVariant(db, l.api, { storeId, actor, productId: 1, variantId: 10, after: depois });
    expect(r).toMatchObject({ changed: true, avisos: [expect.stringContaining("recusou o preço de custo")] });
    expect(l.puts).toEqual([{ price: "120.00", cost: "30.00" }, { price: "120.00" }]);
    expect(await custoPainel()).toBe("30.00");
  });

  it("limpar o custo apaga o do painel; a edição que não mexe no custo não o toca", async () => {
    await semear();
    await gravarCustoDaVariacao(db, { storeId, productId: 1, variantId: 10, cost: "20.00", actor });
    const l = lojaFalsa();
    // o espelho não conhece o custo do painel; a edição parte do que o painel mostra
    const vazio = variantEditSchema.parse({ sku: "S10", price: "100,00", promotional_price: "", stock_management: false, stock: "", image_id: "", cost: "" });
    expect(await updateVariant(db, l.api, { storeId, actor, productId: 1, variantId: 10, after: vazio })).toMatchObject({ changed: true, fields: ["cost"] });
    expect(await custoPainel()).toBeNull();
    expect(l.puts).toEqual([{ cost: null }]);
    const semCusto = variantEditSchema.parse({ sku: "S10", price: "100,00", promotional_price: "", stock_management: false, stock: "", image_id: "" });
    expect(await updateVariant(db, l.api, { storeId, actor, productId: 1, variantId: 10, after: semCusto })).toEqual({ changed: false });
  });

  it("sem custo no painel, mostra o que a loja guarda na variação (e zero não conta)", async () => {
    await upsertProducts(db, storeId, [produto([variante(10, { cost: "12.50" }), variante(11, { cost: "0.00" }), variante(12)])]);
    const c = (await getProductDetail(db, storeId, 1))!.variants.map((v) => v.cost ?? null);
    expect(c).toEqual(["12.50", null, null]);
  });
});

describe("custo do produto = média dos custos das variações", () => {
  it("atualiza product_costs com a média; sem custo de variação não mexe", async () => {
    await upsertProducts(db, storeId, [produto([variante(10), variante(11), variante(12)])]);
    expect(await sincronizarCustoDoProduto(db, storeId, 1, actor)).toBeNull();
    await gravarCustoDaVariacao(db, { storeId, productId: 1, variantId: 10, cost: "10.00", actor });
    await gravarCustoDaVariacao(db, { storeId, productId: 1, variantId: 11, cost: "20.01", actor });
    expect(await sincronizarCustoDoProduto(db, storeId, 1, actor)).toBe(15.01);
    expect((await pg.query<{ cost: string; source: string }>("SELECT cost::text, source FROM product_costs")).rows).toEqual([{ cost: "15.01", source: "manual" }]);
    await gravarCustoDaVariacao(db, { storeId, productId: 1, variantId: 10, cost: null, actor });
    await gravarCustoDaVariacao(db, { storeId, productId: 1, variantId: 11, cost: null, actor });
    expect(await sincronizarCustoDoProduto(db, storeId, 1, actor)).toBeNull();
    expect((await pg.query("SELECT 1 FROM product_costs")).rows).toHaveLength(1); // o custo que já existia fica
  });
});

describe("fornecedor do produto", () => {
  const contato = async (nome: string, kind: string, extra: { fantasia?: string; loja?: string } = {}) =>
    ((await pg.query<{ id: string }>("INSERT INTO contacts (store_id, kind, name, trade_name) VALUES ($1, $2, $3, $4) RETURNING id::text", [extra.loja ?? storeId, kind, nome, extra.fantasia ?? null])).rows[0] as { id: string }).id;

  it("lista só os contatos do tipo fornecedor da loja, por nome (nome fantasia quando houver)", async () => {
    await contato("Zélia Tecidos", "fornecedor");
    await contato("Ana Cliente", "cliente");
    await contato("Beta Ltda", "fornecedor", { fantasia: "Alfa Moda" });
    const outraLoja = ((await pg.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (2, 'y') RETURNING id")).rows[0] as { id: string }).id;
    await contato("De Outra Loja", "fornecedor", { loja: outraLoja });
    expect((await listarFornecedores(db, storeId)).map((f) => f.nome)).toEqual(["Alfa Moda", "Zélia Tecidos"]);
  });

  it("define, troca e tira o fornecedor; registra no Histórico só o id e o nome; recusa quem não é fornecedor", async () => {
    const a = await contato("Alfa", "fornecedor");
    const b = await contato("Beta", "fornecedor");
    const cliente = await contato("Cliente", "cliente");
    expect(await fornecedorDoProduto(db, storeId, 1)).toBeNull();
    expect(await definirFornecedor(db, { storeId, productId: 1, contactId: Number(a), actor })).toEqual({ changed: true });
    expect(await definirFornecedor(db, { storeId, productId: 1, contactId: Number(a), actor })).toEqual({ changed: false });
    expect(await fornecedorDoProduto(db, storeId, 1)).toEqual({ id: a, nome: "Alfa" });
    expect(await definirFornecedor(db, { storeId, productId: 1, contactId: Number(b), actor })).toEqual({ changed: true });
    await expect(definirFornecedor(db, { storeId, productId: 1, contactId: Number(cliente), actor })).rejects.toBeInstanceOf(FornecedorInvalidoError);
    await expect(definirFornecedor(db, { storeId, productId: 1, contactId: 999999, actor })).rejects.toBeInstanceOf(FornecedorInvalidoError);
    expect((await fornecedorDoProduto(db, storeId, 1))?.nome).toBe("Beta");
    expect(await definirFornecedor(db, { storeId, productId: 1, contactId: null, actor })).toEqual({ changed: true });
    expect(await fornecedorDoProduto(db, storeId, 1)).toBeNull();
    const log = (await pg.query<{ acao: string; antes: unknown; depois: unknown }>("SELECT acao, antes, depois FROM audit_log ORDER BY id")).rows;
    expect(log).toHaveLength(3);
    expect(log[0]).toMatchObject({ acao: "produto.fornecedor", antes: { fornecedor: null }, depois: { fornecedor: "Alfa", contato_id: a } });
  });

  it("apagar o contato tira o fornecedor do produto", async () => {
    const a = await contato("Alfa", "fornecedor");
    await definirFornecedor(db, { storeId, productId: 1, contactId: Number(a), actor });
    await pg.query("DELETE FROM contacts WHERE id = $1", [a]);
    expect(await fornecedorDoProduto(db, storeId, 1)).toBeNull();
  });
});

describe("migração", () => {
  it("o custo que a loja já guarda nas variações vira custo do painel; sem custo ou zero não entra", async () => {
    const pg2 = new PGlite();
    const migracoes = loadMigrations(join(process.cwd(), "db/migrations"));
    const ate37 = migracoes.filter((m) => m.name < "0038");
    await runMigrations({ exec: async (s) => void (await pg2.exec(s)), query: async (s, p) => (await pg2.query(s, p)).rows as never }, ate37);
    const sid = ((await pg2.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (1, 'x') RETURNING id")).rows[0] as { id: string }).id;
    await pg2.query("INSERT INTO products (store_id, id, name, published, raw_json) VALUES ($1, 1, 'P', true, '{}'::jsonb)", [sid]);
    for (const [id, cost] of [[10, "12.50"], [11, "0.00"], [12, null], [13, "abc"]] as const) {
      await pg2.query("INSERT INTO variants (store_id, id, product_id, price, raw_json) VALUES ($1, $2, 1, 10, $3::jsonb)", [sid, id, JSON.stringify(cost === null ? {} : { cost })]);
    }
    await runMigrations({ exec: async (s) => void (await pg2.exec(s)), query: async (s, p) => (await pg2.query(s, p)).rows as never }, migracoes);
    expect((await pg2.query<{ variant_id: string; cost: string }>("SELECT variant_id::text, cost::text FROM variant_costs")).rows).toEqual([{ variant_id: "10", cost: "12.50" }]);
  });
});
