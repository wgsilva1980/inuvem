import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import ExcelJS from "exceljs";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import { upsertProducts, type Db } from "@/lib/sync/repo";
import type { Order } from "@/lib/nuvemshop/orders";
import type { Product } from "@/lib/nuvemshop/types";
import { mapearPedido } from "@/lib/orders/map";
import { gravarPedidos } from "@/lib/orders/sync";
import { maisVendidos, margemDoPeriodo } from "@/lib/orders/stats";
import { descontoMaximo, limitarDesconto, margemPercent, precoMinimo, precoPermitido } from "@/lib/costs/math";
import { definirCustos, lerCustosDaLoja, listarCustos, margemMinima, resumoDeCustos, salvarMargemMinima } from "@/lib/costs/repo";
import { gerarPlanilhaCustos, interpretar, lerCsv, lerCusto, lerPlanilha } from "@/lib/costs/planilha";
import { importarCustos } from "@/lib/costs/importar";
import { operationSchema, planOperation } from "@/lib/bulk/operations";
import { loadMirrorProducts } from "@/lib/bulk/repo";
import { COLUNAS_VENDAS } from "@/lib/export/colunas";
import { acaoLabel } from "@/lib/history/labels";

describe("contas de custo e margem", () => {
  it("margem sobre o preço de venda", () => {
    expect(margemPercent(100, 60)).toBe(40);
    expect(margemPercent(100, 120)).toBe(-20);
    expect(margemPercent(0, 10)).toBeNull();
    expect(margemPercent(59.9, 30)).toBeCloseTo(49.92, 2);
  });

  it("preço mínimo e preço permitido (custo ÷ (1 − margem))", () => {
    expect(precoMinimo(60, 0)).toBe(60);
    expect(precoMinimo(60, 40)).toBe(100);
    expect(precoMinimo(33.33, 30)).toBe(47.62); // 47,614… sobe ao centavo
    expect(precoMinimo(0, 30)).toBe(0);
    expect(precoPermitido(59.99, 60, 0)).toBe(false);
    expect(precoPermitido(60, 60, 0)).toBe(true);
    expect(precoPermitido(90, 60, 40)).toBe(false);
    expect(precoPermitido(1, null, 40)).toBe(true); // sem custo, sem trava
    expect(precoPermitido(1, 0, 40)).toBe(true);
  });

  it("desconto máximo e desconto limitado em múltiplos de 5", () => {
    expect(descontoMaximo(100, 60, 0)).toBe(40);
    expect(descontoMaximo(100, 60, 20)).toBe(25); // piso 75
    expect(descontoMaximo(100, null, 20)).toBeNull();
    expect(descontoMaximo(50, 60, 0)).toBe(0); // já abaixo do custo
    expect(limitarDesconto(50, 100, 60, 0)).toEqual({ percent: 40, limitado: true });
    expect(limitarDesconto(30, 100, 60, 20)).toEqual({ percent: 25, limitado: true });
    expect(limitarDesconto(20, 100, 60, 20)).toEqual({ percent: 20, limitado: false });
    expect(limitarDesconto(40, 100, null, 20)).toEqual({ percent: 40, limitado: false });
  });
});

describe("leitura de planilha", () => {
  it("valores em formato brasileiro e inválidos", () => {
    expect(lerCusto("12,50")).toBe(12.5);
    expect(lerCusto("R$ 1.234,56")).toBe(1234.56);
    expect(lerCusto("12.5")).toBe(12.5);
    expect(lerCusto(7)).toBe(7);
    expect(lerCusto("")).toBeNull();
    expect(lerCusto(null)).toBeNull();
    expect(lerCusto("abc")).toBe("invalido");
    expect(lerCusto(-1)).toBe("invalido");
    expect(lerCusto("1e9")).toBe("invalido");
  });

  it("acha as colunas pelo cabeçalho, ignora linhas em branco e exige ID ou SKU", () => {
    const r = interpretar([["ID do Produto", "Nome", "Custo (R$)"], ["10", "x", "30,00"], [null, null, null], ["11.0", "y", ""], ["12", "z", "oi"]]);
    expect(r.linhas).toEqual([
      { linha: 2, id: "10", sku: null, custo: 30 },
      { linha: 4, id: "11", sku: null, custo: null },
      { linha: 5, id: "12", sku: null, custo: "invalido" },
    ]);
    expect(interpretar([["Nome", "Custo"], ["a", "1"]]).erro).toMatch(/ID.*SKU/);
    expect(interpretar([["SKU", "Preço"], ["a", "1"]]).erro).toMatch(/Custo/);
  });

  it("CSV com ; , tab, aspas e BOM", () => {
    expect(lerCsv('﻿SKU;Custo\r\nA1;"12,50"\r\n"B;2";7\r\n')).toEqual([["SKU", "Custo"], ["A1", "12,50"], ["B;2", "7"]]);
    expect(lerCsv("id,custo\n1,10.5\n")).toEqual([["id", "custo"], ["1", "10.5"]]);
    expect(lerCsv("id\tcusto\n1\t10\n")).toEqual([["id", "custo"], ["1", "10"]]);
  });

  it("planilha gerada pelo painel volta a ser lida (xlsx) e CSV é aceito", async () => {
    const buf = await gerarPlanilhaCustos([
      { id: "10", nome: "Vestido", publicado: true, sku: "V10", preco: 100, custo: 45.5, origem: "manual", margem: 54.5 },
      { id: "11", nome: "Saia", publicado: true, sku: null, preco: 80, custo: null, origem: null, margem: null },
    ]);
    const r = await lerPlanilha(buf, "custos.xlsx");
    expect(r.erro).toBeUndefined();
    expect(r.linhas).toEqual([{ linha: 2, id: "10", sku: "V10", custo: 45.5 }, { linha: 3, id: "11", sku: null, custo: null }]); // a linha sem custo vem vazia e o importador a pula
    const csv = await lerPlanilha(Buffer.from("ID;Custo\n5;9,90\n"), "x.csv");
    expect(csv.linhas).toEqual([{ linha: 2, id: "5", sku: null, custo: 9.9 }]);
    expect((await lerPlanilha(Buffer.from("isto não é xlsx"), "x.xlsx")).erro).toMatch(/Não consegui ler/);
    expect((await lerPlanilha(Buffer.alloc(0), "x.csv")).erro).toMatch(/vazia/);
    void ExcelJS;
  });
});

let pg: PGlite;
let db: Db;
let storeId: string;
const actor = "admin@example.com";
beforeEach(async () => {
  pg = new PGlite();
  db = { query: async (text, params) => (await pg.query(text, params as never)).rows as never };
  await runMigrations({ exec: async (s) => void (await pg.exec(s)), query: async (s, p) => (await pg.query(s, p)).rows as never }, loadMigrations(join(process.cwd(), "db/migrations")));
  storeId = (await pg.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (1, 'x') RETURNING id")).rows[0]!.id;
});

const produto = (id: number, preco: string, over: Record<string, unknown> = {}, promo?: string): Product =>
  ({ id, name: { pt: `Produto ${id}` }, published: true, variants: [{ id: id * 10, product_id: id, sku: `SKU${id}`, price: preco, promotional_price: promo ?? null, stock_management: true, stock: 5, values: [{ pt: "U" }], ...over }], updated_at: "2026-10-01T10:00:00+0000" }) as unknown as Product;

describe("custos no banco", () => {
  it("grava, atualiza, apaga e ignora produto que não existe", async () => {
    await upsertProducts(db, storeId, [produto(1, "100.00"), produto(2, "80.00")]);
    const r = await definirCustos(db, { storeId, actor, origem: "manual", itens: [{ productId: "1", custo: 40 }, { productId: "2", custo: 30.5 }, { productId: "99", custo: 1 }] });
    expect(r).toEqual({ gravados: 2, apagados: 0, desconhecidos: ["99"] });
    await definirCustos(db, { storeId, actor, origem: "manual", itens: [{ productId: "1", custo: 45 }, { productId: "2", custo: null }] });
    expect((await pg.query("SELECT product_id::text AS id, cost::text AS cost FROM product_costs ORDER BY 1")).rows).toEqual([{ id: "1", cost: "45.00" }]);
    expect(acaoLabel("custo.definir")).toMatch(/Custo/);
  });

  it("traz custos que a loja já guarda nas variações (média) sem sobrescrever os do painel", async () => {
    await upsertProducts(db, storeId, [
      { ...produto(1, "100.00", { cost: "30.00" }), variants: [{ ...(produto(1, "100.00", { cost: "30.00" }).variants![0] as object) }, { ...(produto(1, "100.00", { cost: "40.00", id: 99 }).variants![0] as object), id: 99 }] } as unknown as Product,
      produto(2, "80.00", { cost: "20.50" }),
      produto(3, "80.00", { cost: "0" }),
      produto(4, "80.00"),
    ]);
    await definirCustos(db, { storeId, actor, origem: "manual", itens: [{ productId: "2", custo: 25 }] });
    expect(await lerCustosDaLoja(db, storeId, actor)).toBe(1);
    expect((await pg.query("SELECT product_id::text AS id, cost::text AS cost, source FROM product_costs ORDER BY 1")).rows).toEqual([
      { id: "1", cost: "35.00", source: "loja" },
      { id: "2", cost: "25.00", source: "manual" },
    ]);
    expect(await lerCustosDaLoja(db, storeId, actor)).toBe(0);
  });

  it("lista com margem e filtros (sem custo, margem baixa, abaixo do custo), busca e resumo", async () => {
    await upsertProducts(db, storeId, [produto(1, "100.00"), produto(2, "100.00", {}, "70.00"), produto(3, "100.00"), produto(4, "100.00", {}), { ...produto(5, "50.00"), published: false }]);
    await definirCustos(db, { storeId, actor, origem: "manual", itens: [{ productId: "1", custo: 60 }, { productId: "2", custo: 60 }, { productId: "3", custo: 120 }] });
    const todos = await listarCustos(db, storeId, { filtro: "todos", margemMinima: 30, pagina: 1 });
    expect(todos.total).toBe(5);
    expect(todos.itens.find((i) => i.id === "2")).toMatchObject({ preco: 70, custo: 60, margem: 14.29 }); // usa o preço promocional
    expect(todos.itens.at(-1)!.publicado).toBe(false); // não publicados ao fim
    expect((await listarCustos(db, storeId, { filtro: "sem_custo", margemMinima: 30, pagina: 1 })).itens.map((i) => i.id)).toEqual(["4", "5"]);
    expect((await listarCustos(db, storeId, { filtro: "margem_baixa", margemMinima: 30, pagina: 1 })).itens.map((i) => i.id)).toEqual(["2", "3"]);
    expect((await listarCustos(db, storeId, { filtro: "abaixo_do_custo", margemMinima: 0, pagina: 1 })).itens.map((i) => i.id)).toEqual(["3"]);
    expect((await listarCustos(db, storeId, { q: "sku4", filtro: "todos", margemMinima: 0, pagina: 1 })).itens.map((i) => i.id)).toEqual(["4"]);
    expect(await resumoDeCustos(db, storeId)).toEqual({ produtos: 5, comCusto: 3, publicadosSemCusto: 1, abaixoDoCusto: 1 });
  });

  it("margem mínima: guarda e lê", async () => {
    expect(await margemMinima(db, storeId)).toBe(0);
    await salvarMargemMinima(db, storeId, 35, actor);
    expect(await margemMinima(db, storeId)).toBe(35);
  });
});

describe("importar planilha", () => {
  it("acha por ID ou por SKU, pula vazios e explica o que ignorou", async () => {
    await upsertProducts(db, storeId, [produto(1, "100.00"), produto(2, "80.00"), produto(3, "50.00")]);
    await pg.query("UPDATE variants SET sku = 'IGUAL' WHERE product_id IN (2, 3)");
    const r = await importarCustos(db, {
      storeId,
      actor,
      linhas: [
        { linha: 2, id: "1", sku: null, custo: 40 },
        { linha: 3, id: null, sku: "IGUAL", custo: 10 }, // SKU em dois produtos
        { linha: 4, id: null, sku: "NADA", custo: 10 },
        { linha: 5, id: "99", sku: null, custo: 10 }, // produto que não existe
        { linha: 6, id: "2", sku: null, custo: "invalido" },
        { linha: 7, id: "3", sku: null, custo: null }, // vazio: pula sem avisar
        { linha: 8, id: "x1", sku: null, custo: 5 },
        { linha: 9, id: "1", sku: null, custo: 42 }, // repetido: vale o último
      ],
    });
    expect(r.atualizados).toBe(1);
    expect(r.ignoradas.map((i) => i.linha)).toEqual([3, 4, 5, 6, 8]);
    expect(r.ignoradas.find((i) => i.linha === 3)!.motivo).toMatch(/mais de um produto/);
    expect((await pg.query("SELECT cost::text AS c FROM product_costs")).rows).toEqual([{ c: "42.00" }]);
    // por SKU único
    const s = await importarCustos(db, { storeId, actor, linhas: [{ linha: 2, id: null, sku: "SKU1", custo: 41 }] });
    expect(s.atualizados).toBe(1);
  });
});

describe("trava de preço abaixo do custo nos lotes", () => {
  const promo = (percent: number) => operationSchema.parse({ type: "promocao", mode: "desconto", percent });

  it("recusa promoção que passa do custo ou da margem mínima, com o motivo; sem custo libera", async () => {
    await upsertProducts(db, storeId, [produto(1, "100.00"), produto(2, "100.00"), produto(3, "100.00")]);
    await definirCustos(db, { storeId, actor, origem: "manual", itens: [{ productId: "1", custo: 60 }, { productId: "2", custo: 60 }] });
    const mirror = await loadMirrorProducts(db, storeId, [1, 2, 3]);
    expect(mirror.map((p) => [p.id, p.cost, p.minMargin])).toEqual([[1, 60, 0], [2, 60, 0], [3, null, 0]]);

    const plano = planOperation(promo(50), mirror);
    expect(plano.items.map((i) => i.productId)).toEqual([3]); // 1 e 2 ficariam em R$ 50 < custo
    expect(plano.ignorados.find((i) => i.productId === 1)!.motivo).toMatch(/abaixo do custo/);
    expect(planOperation(promo(40), mirror).items.map((i) => i.productId)).toEqual([1, 2, 3]); // R$ 60 = custo: pode

    await salvarMargemMinima(db, storeId, 20, actor);
    const com = planOperation(promo(40), await loadMirrorProducts(db, storeId, [1, 3]));
    expect(com.items.map((i) => i.productId)).toEqual([3]);
    expect(com.ignorados[0]!.motivo).toMatch(/abaixo do mínimo de R\$\s?75,00.*margem mínima de 20%/);
  });

  it("baixar o preço ou o promocional também respeita; subir nunca é barrado", async () => {
    await upsertProducts(db, storeId, [produto(1, "100.00"), produto(2, "100.00", {}, "95.00")]);
    await definirCustos(db, { storeId, actor, origem: "manual", itens: [{ productId: "1", custo: 80 }, { productId: "2", custo: 80 }] });
    const mirror = await loadMirrorProducts(db, storeId, [1, 2]);
    const so = (id: number) => mirror.filter((p) => p.id === id);
    const preco = (value: number, target: "preco" | "promocional" = "preco") => operationSchema.parse({ type: "preco", mode: "percentual", value, target });
    expect(planOperation(preco(-10), so(1)).items).toHaveLength(1); // 100 -> 90, ainda acima do custo
    const barrado = planOperation(preco(-30), so(1)); // 100 -> 70
    expect(barrado.items).toEqual([]);
    expect(barrado.ignorados[0]!.motivo).toMatch(/abaixo do custo/);
    expect(planOperation(preco(10), so(1)).items).toHaveLength(1); // subir não é barrado
    expect(planOperation(preco(-20, "promocional"), so(2)).items).toEqual([]); // 95 -> 76 < 80
    expect(planOperation(preco(-10, "promocional"), so(2)).items).toHaveLength(1); // 95 -> 85,50
  });
});

describe("margem nas vendas", () => {
  const pedido = (id: number, linhas: Array<{ product_id: number; quantity: number; price: string }>): Order =>
    ({ id, number: id, created_at: new Date(Date.now() - 3_600_000).toISOString(), total: "0", status: "open", payment_status: "paid", shipping_status: "shipped", customer: { id: id }, products: linhas.map((l) => ({ variant_id: l.product_id * 10, ...l })) }) as unknown as Order;
  const gravar = (os: Order[]) => gravarPedidos(db, storeId, os.map(mapearPedido).filter((m): m is NonNullable<typeof m> => m !== null));
  const periodo = () => {
    const hoje = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
    return { de: hoje, ate: hoje };
  };

  it("lucro bruto e margem só dos produtos com custo, e a cobertura do que não tem custo", async () => {
    await upsertProducts(db, storeId, [produto(1, "100.00"), produto(2, "50.00")]);
    await definirCustos(db, { storeId, actor, origem: "manual", itens: [{ productId: "1", custo: 60 }] });
    await gravar([pedido(1, [{ product_id: 1, quantity: 2, price: "100" }, { product_id: 2, quantity: 1, price: "50" }])]);
    const m = await margemDoPeriodo(db, storeId, periodo());
    expect(m).toEqual({ receita: 250, receitaComCusto: 200, custo: 120, lucroBruto: 80, margem: 40, cobertura: 80 });
    const top = await maisVendidos(db, storeId, periodo(), "unidades", 5);
    expect(top.find((p) => p.product_id === "1")).toMatchObject({ custo: 60 });
    expect(top.find((p) => p.product_id === "2")).toMatchObject({ custo: null });
    const linha = COLUNAS_VENDAS.find((c) => c.titulo.startsWith("Margem"))!;
    expect(linha.valor(top.find((p) => p.product_id === "1")!)).toBe(40);
    expect(linha.valor(top.find((p) => p.product_id === "2")!)).toBeNull();
  });

  it("sem nenhum custo informado a margem é nula", async () => {
    await upsertProducts(db, storeId, [produto(2, "50.00")]);
    await gravar([pedido(1, [{ product_id: 2, quantity: 1, price: "50" }])]);
    expect(await margemDoPeriodo(db, storeId, periodo())).toMatchObject({ receita: 50, margem: null, cobertura: 0 });
  });
});
