import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import { upsertProducts, type Db } from "@/lib/sync/repo";
import type { Order } from "@/lib/nuvemshop/orders";
import type { Product, Variant, VariantInput } from "@/lib/nuvemshop/types";
import { NuvemshopError } from "@/lib/nuvemshop/errors";
import { mapearPedido } from "@/lib/orders/map";
import { gravarPedidos } from "@/lib/orders/sync";
import type { VariantApi } from "@/lib/catalog/update-variant";
import { COBERTURA_PADRAO, JANELAS, PRAZO_PADRAO, escolher, quantidadeSugerida, validarPedido } from "@/lib/purchasing/rules";
import { aCaminhoPorVariacao, listarPedidos, obterPedido } from "@/lib/purchasing/repo";
import { investimento, sugestoesDeCompra } from "@/lib/purchasing/sugestoes";
import { CompraError, cancelarPedidoDeCompra, criarPedidoDeCompra, receberPedidoDeCompra } from "@/lib/purchasing/service";
import { acaoLabel } from "@/lib/history/labels";

describe("regras de compra (puras)", () => {
  it("quantidade: ritmo × (prazo + cobertura) − estoque − a caminho, nunca negativa, arredondando para cima", () => {
    expect(quantidadeSugerida({ ritmo: 2, estoque: 10, aCaminho: 0, prazo: 15, cobertura: 30 })).toBe(80);
    expect(quantidadeSugerida({ ritmo: 2, estoque: 10, aCaminho: 30, prazo: 15, cobertura: 30 })).toBe(50);
    expect(quantidadeSugerida({ ritmo: 0.5, estoque: 0, aCaminho: 0, prazo: 15, cobertura: 30 })).toBe(23); // 22,5 sobe
    expect(quantidadeSugerida({ ritmo: 1, estoque: 100, aCaminho: 0, prazo: 15, cobertura: 30 })).toBe(0);
    expect(quantidadeSugerida({ ritmo: 2, estoque: -3, aCaminho: 0, prazo: 10, cobertura: 10 })).toBe(40); // estoque negativo conta como zero
    expect(quantidadeSugerida({ ritmo: 3, estoque: 0, aCaminho: 0, prazo: 10, cobertura: 20 })).toBe(90); // sem erro de ponto flutuante
  });

  it("parâmetros fora da lista voltam ao padrão", () => {
    expect(escolher(JANELAS, "90", 60)).toBe(90);
    expect(escolher(JANELAS, "7", 60)).toBe(60);
    expect(escolher([7, 15] as const, undefined, PRAZO_PADRAO)).toBe(15);
    expect(COBERTURA_PADRAO).toBe(30);
  });

  it("valida o pedido: fornecedor, data, itens", () => {
    const base = { supplier: "  Malharia  Sol ", expectedOn: "2026-11-01", note: " ok ", itens: [{ variantId: "10", qty: 5 }] };
    expect(validarPedido(base, "2026-10-10")).toEqual({ ok: true, value: { supplier: "Malharia Sol", expectedOn: "2026-11-01", note: "ok", itens: [{ variantId: "10", qty: 5 }] } });
    expect(validarPedido({ ...base, expectedOn: "", note: "" }, "2026-10-10")).toMatchObject({ ok: true, value: { expectedOn: null, note: null } });
    const ruins: Array<Record<string, unknown>> = [
      { supplier: "A" }, { supplier: "x".repeat(81) }, { expectedOn: "2026-02-30" }, { expectedOn: "01/11/2026" }, { expectedOn: "2026-10-09" }, { expectedOn: "2028-01-01" },
      { itens: [] }, { itens: "x" }, { itens: [{ variantId: "1", qty: 0 }] }, { itens: [{ variantId: "1", qty: 1.5 }] }, { itens: [{ variantId: "1", qty: 10000 }] },
      { itens: [{ variantId: "a", qty: 1 }] }, { itens: [{ variantId: "1", qty: 1 }, { variantId: "1", qty: 2 }] }, { itens: Array.from({ length: 61 }, (_, i) => ({ variantId: String(i + 1), qty: 1 })) },
    ];
    for (const r of ruins) expect(validarPedido({ ...base, ...r }, "2026-10-10"), JSON.stringify(r).slice(0, 60)).toMatchObject({ ok: false });
  });
});

let pg: PGlite;
let db: Db;
let storeId: string;
const actor = "admin@example.com";
const store = new Map<number, Variant>();

beforeEach(async () => {
  pg = new PGlite();
  db = { query: async (text, params) => (await pg.query(text, params as never)).rows as never };
  await runMigrations({ exec: async (s) => void (await pg.exec(s)), query: async (s, p) => (await pg.query(s, p)).rows as never }, loadMigrations(join(process.cwd(), "db/migrations")));
  storeId = (await pg.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (1, 'x') RETURNING id")).rows[0]!.id;
  store.clear();
});

const variante = (id: number, productId: number, over: Partial<Variant> = {}): Variant => ({ id, product_id: productId, sku: `SKU-${id}`, price: "100.00", stock_management: true, stock: 10, values: [{ pt: "Azul" }, { pt: "M" }], ...over });
async function produto(id: number, nome: string, variantes: Variant[], publicado = true) {
  for (const v of variantes) store.set(v.id as number, v);
  await upsertProducts(db, storeId, [{ id, name: { pt: nome }, published: publicado, categories: [], images: [], variants: variantes, attributes: [{ pt: "COR" }, { pt: "TAMANHO" }], updated_at: "2026-10-01T10:00:00+0000" } as unknown as Product]);
}
const diasAtras = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
async function vendas(linhas: Array<{ productId: number; variantId: number; qty: number; dias?: number; pago?: boolean }>) {
  const pedidos = linhas.map((l, i) => ({ id: 9000 + i, number: 9000 + i, created_at: diasAtras(l.dias ?? 5), total: "100", discount: "0", status: "open", payment_status: l.pago === false ? "pending" : "paid", shipping_status: "unpacked", customer: { id: 1 }, products: [{ product_id: l.productId, variant_id: l.variantId, quantity: l.qty, price: "100" }] }) as unknown as Order);
  await gravarPedidos(db, storeId, pedidos.map(mapearPedido).filter((m): m is NonNullable<typeof m> => m !== null));
}
const custo = (productId: number, valor: number) => pg.query("INSERT INTO product_costs (store_id, product_id, cost, source) VALUES ($1, $2, $3, 'manual')", [storeId, productId, valor]);
const ARGS = { janela: 30, prazo: 15, cobertura: 30 };

describe("sugestão de compra", () => {
  it("só variações publicadas, com controle de estoque e que venderam; conta pelo ritmo e ordena esgotadas primeiro", async () => {
    await produto(1, "Vestido", [variante(100, 1, { stock: 10 }), variante(101, 1, { stock: 0 }), variante(102, 1, { stock: 500 }), variante(103, 1, { stock_management: false, stock: null })]);
    await produto(2, "Saia", [variante(200, 2, { stock: 1 })], false); // despublicado
    await vendas([
      { productId: 1, variantId: 100, qty: 60 }, // 2/dia em 30 dias
      { productId: 1, variantId: 101, qty: 15 }, // esgotada
      { productId: 1, variantId: 102, qty: 3 }, // estoque de sobra
      { productId: 1, variantId: 103, qty: 9 }, // sem controle de estoque
      { productId: 2, variantId: 200, qty: 30 },
      { productId: 1, variantId: 100, qty: 99, pago: false }, // não pago não conta
      { productId: 1, variantId: 100, qty: 99, dias: 40 }, // fora da janela
    ]);
    await custo(1, 25);
    const r = await sugestoesDeCompra(db, storeId, ARGS);
    expect(r.map((x) => x.variantId)).toEqual(["101", "100"]); // esgotada primeiro
    expect(r[1]).toMatchObject({ estoque: 10, vendidas: 60, aCaminho: 0, sugerido: 80, custo: 25, variacao: "Azul / M" });
    expect(r[0]).toMatchObject({ diasRestantes: null, sugerido: 23 }); // 15/30 = 0,5/dia × 45 = 22,5 -> 23
    expect(investimento(r)).toEqual({ total: 25 * (80 + 23), semCusto: 0 });
  });

  it("o que está a caminho em pedido aberto abate da sugestão; pedido fechado ou cancelado não", async () => {
    await produto(1, "Vestido", [variante(100, 1, { stock: 10 })]);
    await vendas([{ productId: 1, variantId: 100, qty: 60 }]);
    const p = await criarPedidoDeCompra(db, { storeId, actor, pedido: { supplier: "Sol", expectedOn: null, note: null, itens: [{ variantId: "100", qty: 30 }] } });
    expect((await aCaminhoPorVariacao(db, storeId)).get("100")).toBe(30);
    expect((await sugestoesDeCompra(db, storeId, ARGS))[0]!.sugerido).toBe(50);
    await cancelarPedidoDeCompra(db, { storeId, actor, id: p.id });
    expect((await sugestoesDeCompra(db, storeId, ARGS))[0]!.sugerido).toBe(80);
  });

  it("sem custo informado aparece no total de itens sem custo", async () => {
    await produto(1, "Vestido", [variante(100, 1, { stock: 0 })]);
    await vendas([{ productId: 1, variantId: 100, qty: 30 }]);
    expect(investimento(await sugestoesDeCompra(db, storeId, ARGS))).toEqual({ total: 0, semCusto: 1 });
  });
});

const entrada = (itens: Array<{ variantId: string; qty: number }>) => ({ supplier: "Malharia Sol", expectedOn: null, note: null, itens });

describe("pedido de compra", () => {
  it("grava nome, variação, SKU e custo do momento; audita", async () => {
    await produto(1, "Vestido Midi", [variante(100, 1)]);
    await custo(1, 42.5);
    const p = await criarPedidoDeCompra(db, { storeId, actor, pedido: { ...entrada([{ variantId: "100", qty: 12 }]), expectedOn: "2026-12-01", note: "urgente" } });
    expect(p).toMatchObject({ fornecedor: "Malharia Sol", status: "aberto", previsto: "2026-12-01", observacao: "urgente", total: 510, semCusto: 0, itens: [{ produto: "Vestido Midi", variacao: "Azul / M", sku: "SKU-100", qty: 12, custo: 42.5, recebido: false }] });
    await pg.query("UPDATE product_costs SET cost = 99"); // mudar o custo depois não mexe no pedido
    expect((await obterPedido(db, storeId, p.id))!.total).toBe(510);
    expect((await pg.query("SELECT acao, entidade, depois FROM audit_log")).rows).toMatchObject([{ acao: "compra.criar", entidade: "compra", depois: { itens: 1, unidades: 12, total: 510 } }]);
    expect(acaoLabel("compra.criar")).toMatch(/Pedido de compra/);
    expect((await listarPedidos(db, storeId)).map((x) => x.id)).toEqual([p.id]);
  });

  it("recusa variação que não existe ou sem controle de estoque", async () => {
    await produto(1, "Vestido", [variante(100, 1), variante(101, 1, { stock_management: false, stock: null })]);
    await expect(criarPedidoDeCompra(db, { storeId, actor, pedido: entrada([{ variantId: "999", qty: 1 }]) })).rejects.toBeInstanceOf(CompraError);
    await expect(criarPedidoDeCompra(db, { storeId, actor, pedido: entrada([{ variantId: "101", qty: 1 }]) })).rejects.toThrow(/controle de estoque/);
    expect((await pg.query("SELECT count(*)::int AS n FROM purchase_orders")).rows[0]).toEqual({ n: 0 });
  });
});

/** Loja falsa: get devolve a variante atual; put aplica o que veio e devolve o resultado. `falhar` faz o put dessa variante dar erro. */
function lojaFalsa(falhar: Set<number> = new Set()) {
  const puts: Array<{ variantId: number; input: VariantInput }> = [];
  const api: VariantApi = {
    get: async (_p, vid) => ({ ...store.get(vid)! }),
    put: async (_p, vid, input) => {
      if (falhar.has(vid)) throw new NuvemshopError("500", 500, null, "caiu");
      puts.push({ variantId: vid, input });
      const novo = { ...store.get(vid)!, ...(input as Partial<Variant>) } as Variant;
      store.set(vid, novo);
      return novo;
    },
  };
  return { api, puts };
}
const estoqueEspelho = async (id: number) => (await pg.query<{ stock: number }>("SELECT stock FROM variants WHERE id = $1", [id])).rows[0]!.stock;

describe("recebimento", () => {
  it("soma cada linha ao estoque da loja, fecha o pedido e registra no Histórico", async () => {
    await produto(1, "Vestido", [variante(100, 1, { stock: 4 }), variante(101, 1, { stock: 0 })]);
    const p = await criarPedidoDeCompra(db, { storeId, actor, pedido: entrada([{ variantId: "100", qty: 10 }, { variantId: "101", qty: 6 }]) });
    const { api, puts } = lojaFalsa();
    const r = await receberPedidoDeCompra(db, api, { storeId, actor, id: p.id, somarEstoque: true });
    expect(r).toEqual({ status: "recebido", somados: 2, pendentes: 0, erros: [], continua: false });
    expect(puts.map((x) => x.input)).toEqual([{ stock: 14 }, { stock: 6 }]); // só o estoque vai à loja
    expect(await estoqueEspelho(100)).toBe(14);
    expect(await estoqueEspelho(101)).toBe(6);
    expect(await obterPedido(db, storeId, p.id)).toMatchObject({ status: "recebido", estoqueAtualizado: true });
    expect((await aCaminhoPorVariacao(db, storeId)).size).toBe(0);
    const acoes = (await pg.query<{ acao: string }>("SELECT acao FROM audit_log ORDER BY id")).rows.map((x) => x.acao);
    expect(acoes).toEqual(["compra.criar", "variante.atualizar", "variante.atualizar", "compra.receber"]);
    await expect(receberPedidoDeCompra(db, api, { storeId, actor, id: p.id, somarEstoque: true })).rejects.toThrow(/já foi fechado/);
  });

  it("linha que falha fica pendente; tentar de novo soma só o que faltou (nunca duas vezes)", async () => {
    await produto(1, "Vestido", [variante(100, 1, { stock: 4 }), variante(101, 1, { stock: 0 })]);
    const p = await criarPedidoDeCompra(db, { storeId, actor, pedido: entrada([{ variantId: "100", qty: 10 }, { variantId: "101", qty: 6 }]) });
    const ruim = lojaFalsa(new Set([101]));
    const r1 = await receberPedidoDeCompra(db, ruim.api, { storeId, actor, id: p.id, somarEstoque: true });
    expect(r1).toMatchObject({ status: "parcial", somados: 1, pendentes: 1 });
    expect(r1.erros[0]).toMatch(/Vestido \(Azul \/ M\)/);
    expect((await obterPedido(db, storeId, p.id))!.status).toBe("aberto");
    expect((await aCaminhoPorVariacao(db, storeId)).get("101")).toBe(6); // a pendente ainda conta como a caminho
    expect((await aCaminhoPorVariacao(db, storeId)).has("100")).toBe(false);
    const boa = lojaFalsa();
    const r2 = await receberPedidoDeCompra(db, boa.api, { storeId, actor, id: p.id, somarEstoque: true });
    expect(r2).toMatchObject({ status: "recebido", somados: 1, pendentes: 0 });
    expect(boa.puts.map((x) => x.variantId)).toEqual([101]); // a 100 não foi somada de novo
    expect(await estoqueEspelho(100)).toBe(14);
    expect(await estoqueEspelho(101)).toBe(6);
  });

  it("duas chamadas ao mesmo tempo não somam duas vezes", async () => {
    await produto(1, "Vestido", [variante(100, 1, { stock: 4 })]);
    const p = await criarPedidoDeCompra(db, { storeId, actor, pedido: entrada([{ variantId: "100", qty: 10 }]) });
    const { api, puts } = lojaFalsa();
    const [a, b] = await Promise.allSettled([receberPedidoDeCompra(db, api, { storeId, actor, id: p.id, somarEstoque: true }), receberPedidoDeCompra(db, api, { storeId, actor, id: p.id, somarEstoque: true })]);
    expect([a.status, b.status].filter((s) => s === "fulfilled").length).toBeGreaterThanOrEqual(1);
    expect(puts).toHaveLength(1);
    expect(await estoqueEspelho(100)).toBe(14);
  });

  it("alteração por fora: a segunda tentativa soma sobre o estoque certo", async () => {
    await produto(1, "Vestido", [variante(100, 1, { stock: 4 })]);
    const p = await criarPedidoDeCompra(db, { storeId, actor, pedido: entrada([{ variantId: "100", qty: 10 }]) });
    store.set(100, { ...store.get(100)!, stock: 20 }); // alguém mexeu na loja depois da sincronização
    const { api } = lojaFalsa();
    const r = await receberPedidoDeCompra(db, api, { storeId, actor, id: p.id, somarEstoque: true });
    expect(r.status).toBe("recebido");
    expect(store.get(100)!.stock).toBe(30);
    expect(await estoqueEspelho(100)).toBe(30);
  });

  it("recebimento sem mexer no estoque só fecha o pedido (a loja nem é chamada)", async () => {
    await produto(1, "Vestido", [variante(100, 1)]);
    const p = await criarPedidoDeCompra(db, { storeId, actor, pedido: entrada([{ variantId: "100", qty: 10 }]) });
    const nunca: VariantApi = { get: async () => { throw new Error("não deveria"); }, put: async () => { throw new Error("não deveria"); } };
    expect(await receberPedidoDeCompra(db, nunca, { storeId, actor, id: p.id, somarEstoque: false })).toMatchObject({ status: "recebido", somados: 0 });
    expect(await obterPedido(db, storeId, p.id)).toMatchObject({ status: "recebido", estoqueAtualizado: false });
    expect((await aCaminhoPorVariacao(db, storeId)).size).toBe(0);
  });

  it("acabou o tempo: para e pede para continuar; depois conclui", async () => {
    await produto(1, "Vestido", [variante(100, 1, { stock: 1 }), variante(101, 1, { stock: 1 })]);
    const p = await criarPedidoDeCompra(db, { storeId, actor, pedido: entrada([{ variantId: "100", qty: 1 }, { variantId: "101", qty: 1 }]) });
    const { api } = lojaFalsa();
    let t = 0;
    const r1 = await receberPedidoDeCompra(db, api, { storeId, actor, id: p.id, somarEstoque: true, budgetMs: 10, agora: () => (t += 6) });
    expect(r1).toMatchObject({ status: "parcial", continua: true });
    expect(r1.somados).toBeLessThan(2);
    const r2 = await receberPedidoDeCompra(db, api, { storeId, actor, id: p.id, somarEstoque: true });
    expect(r2.status).toBe("recebido");
    expect(await estoqueEspelho(100)).toBe(2);
    expect(await estoqueEspelho(101)).toBe(2);
  });
});

describe("cancelamento", () => {
  it("cancela aberto; recusa fechado e o que já foi parcialmente somado", async () => {
    await produto(1, "Vestido", [variante(100, 1, { stock: 1 }), variante(101, 1, { stock: 1 })]);
    const a = await criarPedidoDeCompra(db, { storeId, actor, pedido: entrada([{ variantId: "100", qty: 1 }]) });
    await cancelarPedidoDeCompra(db, { storeId, actor, id: a.id });
    expect((await obterPedido(db, storeId, a.id))!.status).toBe("cancelado");
    await expect(cancelarPedidoDeCompra(db, { storeId, actor, id: a.id })).rejects.toThrow(/aberto/);
    const b = await criarPedidoDeCompra(db, { storeId, actor, pedido: entrada([{ variantId: "100", qty: 1 }, { variantId: "101", qty: 1 }]) });
    await receberPedidoDeCompra(db, lojaFalsa(new Set([101])).api, { storeId, actor, id: b.id, somarEstoque: true });
    await expect(cancelarPedidoDeCompra(db, { storeId, actor, id: b.id })).rejects.toThrow(/somada ao estoque/);
    await expect(cancelarPedidoDeCompra(db, { storeId, actor, id: "99999" })).rejects.toThrow(/não encontrado/);
  });
});
