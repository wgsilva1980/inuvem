import { beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import { upsertProducts, type Db } from "@/lib/sync/repo";
import { handleWebhook, type ResourceApi, type WebhookDeps } from "@/lib/webhooks/handler";
import { ACAO_REPUBLICAR, autoRepublicarLigado, definirManterDespublicado, listarAguardandoEstoque, republicarComEstoqueAgora, salvarAutoRepublicar, temEstoque } from "@/lib/automations/in-stock";
import { salvarAutoDespublicar, ultimasAcoesAutomaticas } from "@/lib/automations/out-of-stock";
import { gravarPedidos } from "@/lib/orders/sync";
import { mapearPedido } from "@/lib/orders/map";
import { classificarReposicao, textoDias, variacoesComRitmo, type VariacaoEstoque } from "@/lib/stock/insights";
import { COLUNAS_REPOSICAO } from "@/lib/export/colunas";
import { gerarXlsx } from "@/lib/export/xlsx";
import { acaoLabel } from "@/lib/history/labels";
import type { Order } from "@/lib/nuvemshop/orders";
import type { Category, Product } from "@/lib/nuvemshop/types";

const SECRET = "segredo-do-app";
let pg: PGlite;
let db: Db;
let storeId: string;
let clock: number;

const sign = (body: string) => createHmac("sha256", SECRET).update(body).digest("hex");
type V = { stock_management?: boolean; stock?: number | null };
const produto = (id: number, vs: V[], published = true): Product =>
  ({ id, name: { pt: `Produto ${id}` }, published, categories: [], variants: vs.map((v, n) => ({ id: id * 100 + n, product_id: id, price: "10.00", stock_management: true, stock: 5, values: [{ pt: `V${n}` }], ...v })), updated_at: "2026-10-01T10:00:00+0000" }) as unknown as Product;

function loja(inicial: Product[]) {
  const produtos = new Map(inicial.map((p) => [p.id, structuredClone(p)]));
  const puts: Array<{ id: number; published: boolean }> = [];
  const api: ResourceApi & { setPublished: (id: number, published: boolean) => Promise<Product> } = {
    getProduct: async (id) => structuredClone(produtos.get(id)!),
    getCategory: async (id) => ({ id, name: { pt: "c" } }) as Category,
    setPublished: async (id, published) => {
      puts.push({ id, published });
      const p = produtos.get(id)!;
      p.published = published;
      return structuredClone(p);
    },
  };
  return { api, puts, produtos };
}
const deps = (api: ResourceApi): WebhookDeps => ({ db, clientSecret: SECRET, findStore: async (n) => (n === 1 ? { id: storeId, nuvemshop_store_id: "1" } : null), apiFor: async () => api, now: () => clock, log: () => {} });
const enviar = async (api: ResourceApi, id: number) => {
  clock += 10_000;
  const raw = JSON.stringify({ store_id: 1, event: "product/updated", id });
  return handleWebhook(deps(api), raw, sign(raw));
};
const publicado = async (id: number) => (await pg.query<{ published: boolean }>("SELECT published FROM products WHERE id = $1", [id])).rows[0]!.published;
const espera = async () => (await pg.query<{ product_id: string; keep_unpublished: boolean }>("SELECT product_id::text, keep_unpublished FROM auto_unpublished ORDER BY product_id")).rows;

beforeEach(async () => {
  pg = new PGlite();
  db = { query: async (text, params) => (await pg.query(text, params as never)).rows as never };
  await runMigrations(
    { exec: async (s) => void (await pg.exec(s)), query: async (s, p) => (await pg.query(s, p)).rows as never },
    loadMigrations(join(process.cwd(), "db/migrations")),
  );
  storeId = ((await pg.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (1, 'x') RETURNING id")).rows[0] as { id: string }).id;
  clock = 1_000_000;
});

describe("regra: publicar de novo quando o estoque volta", () => {
  it("quem tem estoque ou ilimitado conta como disponível", () => {
    expect(temEstoque(produto(1, [{ stock: 0 }, { stock: 2 }]))).toBe(true);
    expect(temEstoque(produto(1, [{ stock: 0 }, { stock_management: false }]))).toBe(true);
    expect(temEstoque(produto(1, [{ stock: 0 }]))).toBe(false);
    expect(temEstoque(produto(1, []))).toBe(false);
  });

  it("ciclo completo: a regra despublica (e lembra), o estoque volta e o produto é publicado de novo", async () => {
    await salvarAutoDespublicar(db, storeId, true, "a@b.c");
    await salvarAutoRepublicar(db, storeId, true, "a@b.c");
    const l = loja([produto(1, [{ stock: 0 }])]);
    await enviar(l.api, 1);
    expect(l.puts).toEqual([{ id: 1, published: false }]);
    expect(await espera()).toEqual([{ product_id: "1", keep_unpublished: false }]);
    expect((await listarAguardandoEstoque(db, storeId))[0]).toMatchObject({ product_id: "1", comEstoque: false });

    // ainda sem estoque: nada
    await enviar(l.api, 1);
    expect(l.puts).toHaveLength(1);

    // o estoque volta na loja
    l.produtos.get(1)!.variants![0]!.stock = 4;
    await enviar(l.api, 1);
    expect(l.puts).toEqual([{ id: 1, published: false }, { id: 1, published: true }]);
    expect(await publicado(1)).toBe(true);
    expect(await espera()).toEqual([]);
    const log = (await pg.query<{ actor_email: string; acao: string; sucesso: boolean }>("SELECT actor_email, acao, sucesso FROM audit_log ORDER BY id")).rows;
    expect(log.map((a) => a.acao)).toEqual(["produto.despublicar_sem_estoque", ACAO_REPUBLICAR]);
    expect(acaoLabel(ACAO_REPUBLICAR, "produto")).toBe("Produto publicado automaticamente (estoque voltou)");
    expect((await ultimasAcoesAutomaticas(db, storeId)).map((a) => a.acao)).toEqual([ACAO_REPUBLICAR, "produto.despublicar_sem_estoque"]);

    // sem laço: o evento do próprio PUT chega com o produto publicado e nada muda
    await enviar(l.api, 1);
    expect(l.puts).toHaveLength(2);
  });

  it("desligada (padrão): o produto fica esperando", async () => {
    await salvarAutoDespublicar(db, storeId, true, "a@b.c");
    const l = loja([produto(1, [{ stock: 0 }])]);
    await enviar(l.api, 1);
    l.produtos.get(1)!.variants![0]!.stock = 9;
    await enviar(l.api, 1);
    expect(l.puts).toEqual([{ id: 1, published: false }]);
    expect(await autoRepublicarLigado(db, storeId)).toBe(false);
    expect((await listarAguardandoEstoque(db, storeId))[0]).toMatchObject({ comEstoque: true }); // o espelho mostra o estoque de volta, mas com a regra desligada ninguém republica sozinho
  });

  it("nunca publica o que a regra não despublicou (nem o que você mantém fora)", async () => {
    await salvarAutoRepublicar(db, storeId, true, "a@b.c");
    const l = loja([produto(1, [{ stock: 5 }], false)]); // despublicado à mão
    await enviar(l.api, 1);
    expect(l.puts).toEqual([]);

    await salvarAutoDespublicar(db, storeId, true, "a@b.c");
    const m = loja([produto(2, [{ stock: 0 }])]);
    await enviar(m.api, 2);
    expect(await definirManterDespublicado(db, storeId, 2, true)).toBe(true);
    m.produtos.get(2)!.variants![0]!.stock = 8;
    await enviar(m.api, 2);
    expect(m.puts).toEqual([{ id: 2, published: false }]);
    expect(await definirManterDespublicado(db, storeId, 999, true)).toBe(false);
  });

  it("produto publicado à mão sai da lista de espera", async () => {
    await salvarAutoDespublicar(db, storeId, true, "a@b.c");
    const l = loja([produto(1, [{ stock: 0 }])]);
    await enviar(l.api, 1);
    expect(await espera()).toHaveLength(1);
    l.produtos.get(1)!.published = true;
    l.produtos.get(1)!.variants![0]!.stock = 3;
    await enviar(l.api, 1);
    expect(await espera()).toEqual([]);
  });

  it("republicar agora: confere cada um na loja, respeita 'manter despublicado' e não depende da opção", async () => {
    await upsertProducts(db, storeId, [produto(1, [{ stock: 0 }], false), produto(2, [{ stock: 0 }], false), produto(3, [{ stock: 0 }], false)]);
    for (const id of [1, 2, 3]) await pg.query("INSERT INTO auto_unpublished (store_id, product_id) VALUES ($1, $2)", [storeId, id]);
    await definirManterDespublicado(db, storeId, 3, true);
    // na loja: 1 recebeu estoque; 2 continua zerado; 3 recebeu mas está marcado para manter
    const l = loja([produto(1, [{ stock: 6 }], false), produto(2, [{ stock: 0 }], false), produto(3, [{ stock: 6 }], false)]);
    // o espelho já mostra o estoque do 1 e do 3 (para entrarem na fila); o do 2 também, para testar a conferência na loja
    await upsertProducts(db, storeId, [produto(1, [{ stock: 6 }], false), produto(2, [{ stock: 6 }], false), produto(3, [{ stock: 6 }], false)]);
    const r = await republicarComEstoqueAgora(db, { getProduct: l.api.getProduct, setPublished: l.api.setPublished }, { storeId, ator: "admin@x.com", budgetMs: 10_000 });
    expect(r).toMatchObject({ republicados: 1, semEstoque: 1, falhas: [], restantes: false });
    expect(l.puts).toEqual([{ id: 1, published: true }]);
    expect(await publicado(1)).toBe(true);
    expect(await publicado(2)).toBe(false);
    expect((await espera()).map((e) => e.product_id)).toEqual(["2", "3"]);
  });
});

describe("estoque inteligente", () => {
  const v = (id: number, estoque: number, vendidas: number, janela = 30): VariacaoEstoque => ({ variant_id: String(id), product_id: String(id), produto: `P${id}`, publicado: true, sku: null, variacao: "M", estoque, vendidas, ritmo: vendidas / janela });

  it("classifica acabando e esgotados, ordena e sugere a reposição", () => {
    const r = classificarReposicao(
      [v(1, 6, 30), v(2, 30, 30), v(3, 0, 12), v(4, 0, 40), v(5, 0, 0), v(6, 3, 0), v(7, 2, 6)],
      { limite: 14, cobertura: 30 },
    );
    // 1: ritmo 1/dia, 6 dias; 7: ritmo 0,2/dia, 10 dias; 2: 30 dias (fora); 6 não vende (fora)
    expect(r.acabando.map((l) => [l.variant_id, Math.round(l.diasRestantes!)])).toEqual([["1", 6], ["7", 10]]);
    expect(r.acabando[0]!.sugerido).toBe(24); // 1 un/dia × 30 − 6
    expect(r.acabando[1]!.sugerido).toBe(4); // 0,2 × 30 − 2
    expect(r.esgotados.map((l) => [l.variant_id, l.sugerido])).toEqual([["4", 40], ["3", 12]]);
    expect(textoDias(0.4)).toBe("menos de 1 dia");
    expect(textoDias(1)).toBe("1 dia");
    expect(textoDias(6.2)).toBe("6 dias");
  });

  it("variacoesComRitmo usa os pedidos pagos da janela por variação e só variações com controle de estoque", async () => {
    await upsertProducts(db, storeId, [produto(1, [{ stock: 4 }, { stock: 0 }, { stock_management: false, stock: null }])]);
    const dia = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
    const pedido = (id: number, linhas: Array<{ variant_id: number; quantity: number }>, over: Record<string, unknown> = {}) =>
      mapearPedido({ id, number: id, created_at: dia(3), total: "10", status: "open", payment_status: "paid", products: linhas.map((l) => ({ product_id: 1, price: "10", ...l })), ...over } as unknown as Order)!;
    await gravarPedidos(db, storeId, [
      pedido(1, [{ variant_id: 100, quantity: 6 }, { variant_id: 101, quantity: 3 }]),
      pedido(2, [{ variant_id: 100, quantity: 99 }], { status: "cancelled" }),
      pedido(3, [{ variant_id: 100, quantity: 50 }], { created_at: dia(60) }), // fora da janela de 30 dias
    ]);
    const vars = await variacoesComRitmo(db, storeId, 30);
    expect(vars.map((x) => [x.variant_id, x.estoque, x.vendidas])).toEqual(expect.arrayContaining([["100", 4, 6], ["101", 0, 3]]));
    expect(vars).toHaveLength(2); // a variação sem controle de estoque não entra
    expect((await variacoesComRitmo(db, storeId, 90)).find((x) => x.variant_id === "100")!.vendidas).toBe(56);
    // 4 / (6/30) = 20 dias: fora com limite de 14, dentro com 21
    expect(classificarReposicao(vars, { limite: 14, cobertura: 30 }).acabando).toEqual([]);
    expect(classificarReposicao(vars, { limite: 21, cobertura: 30 }).acabando.map((l) => l.variant_id)).toEqual(["100"]);
  });

  it("planilha de reposição", async () => {
    const r = classificarReposicao([v(4, 0, 40), v(1, 6, 30)], { limite: 14, cobertura: 30 });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await gerarXlsx("Reposição", COLUNAS_REPOSICAO, [...r.esgotados, ...r.acabando])) as never);
    const ws = wb.getWorksheet("Reposição")!;
    expect((ws.getRow(1).values as string[]).slice(1, 5)).toEqual(["Situação", "ID do produto", "Produto", "Variação"]);
    expect((ws.getRow(2).values as unknown[]).slice(1)).toEqual(["Esgotado", "4", "P4", "M", undefined, 0, 40, 1.33, "Esgotado", 40, "Sim"]);
    expect((ws.getRow(3).values as unknown[])[1]).toBe("Acabando");
  });
});
