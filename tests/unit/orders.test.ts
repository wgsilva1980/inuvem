import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import { upsertCategories, upsertProducts, type Db } from "@/lib/sync/repo";
import type { Order } from "@/lib/nuvemshop/orders";
import type { Category, Product } from "@/lib/nuvemshop/types";
import { mapearPedido, valoresDaVariacao } from "@/lib/orders/map";
import { gravarPedidos, passoPedidos, reconstruirVendas, ultimaSincronizacaoPedidos, type FontePedidos } from "@/lib/orders/sync";
import { coberturaDosPedidos, maisVendidos, periodos, porCategoria, porCorETamanho, resumoDoPeriodo, somarDias, vendasPorDia } from "@/lib/orders/stats";
import { resumoVendas } from "@/lib/sales/sync";
import { redactCustomer } from "@/lib/privacy";
import { COLUNAS_VENDAS } from "@/lib/export/colunas";
import { gerarXlsx } from "@/lib/export/xlsx";

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
  storeId = ((await pg.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (77, 'x') RETURNING id")).rows[0] as { id: string }).id;
});

const diaAtras = (n: number, hora = 15) => {
  const d = new Date(Date.now() - n * 86_400_000);
  d.setUTCHours(hora, 0, 0, 0);
  return d.toISOString();
};
type Linha = { product_id: number; variant_id?: number; quantity: number; price: string; variant_values?: unknown; name?: unknown };
const pedido = (id: number, linhas: Linha[], over: Record<string, unknown> = {}): Order =>
  ({ id, number: id, created_at: diaAtras(1), updated_at: diaAtras(1), total: "100.00", discount: "0.00", status: "open", payment_status: "paid", shipping_status: "unpacked", customer: { id: 5 }, products: linhas, ...over }) as unknown as Order;
const mapear = (os: Order[]) => os.map(mapearPedido).filter((m): m is NonNullable<typeof m> => m !== null);

describe("mapeamento", () => {
  it("normaliza pedido e linhas (nome multi-idioma, valores da variação, quantidade inválida)", () => {
    const m = mapearPedido(
      pedido(1, [
        { product_id: 10, variant_id: 100, quantity: 2, price: "49.90", name: { pt: "Vestido" }, variant_values: ["Azul", "P"] },
        { product_id: 11, quantity: 0 as never, price: "-5" as never, variant_values: "Rosa / M" },
      ]),
    )!;
    expect(m.pedido).toMatchObject({ id: 1, total: 100, status: "open", payment_status: "paid", customer_id: 5 });
    expect(m.itens[0]).toMatchObject({ seq: 1, product_id: 10, variant_id: 100, name: "Vestido", quantity: 2, unit_price: 49.9, variant_values: ["Azul", "P"] });
    expect(m.itens[1]).toMatchObject({ seq: 2, quantity: 1, unit_price: 0, variant_values: ["Rosa", "M"] });
  });
  it("pedido sem data válida não entra; valores da variação aceitam formatos diferentes", () => {
    expect(mapearPedido(pedido(2, [], { created_at: "ontem" }))).toBeNull();
    expect(valoresDaVariacao([{ pt: "Azul" }, "P"])).toEqual(["Azul", "P"]);
    expect(valoresDaVariacao([])).toBeNull();
    expect(valoresDaVariacao(null)).toBeNull();
  });
});

describe("gravarPedidos", () => {
  it("é idempotente, troca as linhas do pedido e reflete mudança de situação", async () => {
    const a = pedido(1, [{ product_id: 10, quantity: 1, price: "50" }, { product_id: 11, quantity: 2, price: "20" }]);
    expect(await gravarPedidos(db, storeId, mapear([a]))).toEqual({ novos: 1, atualizados: 0, itens: 2 });
    const b = pedido(1, [{ product_id: 10, quantity: 3, price: "50" }], { status: "cancelled" });
    expect(await gravarPedidos(db, storeId, mapear([b]))).toEqual({ novos: 0, atualizados: 1, itens: 1 });
    expect((await pg.query("SELECT 1 FROM order_items")).rows).toHaveLength(1);
    expect((await pg.query<{ status: string }>("SELECT status FROM orders WHERE id = 1")).rows[0]!.status).toBe("cancelled");
    expect(await gravarPedidos(db, storeId, [])).toEqual({ novos: 0, atualizados: 0, itens: 0 });
  });
});

describe("passoPedidos", () => {
  const fonte = (paginas: Order[][], vistos: Array<Record<string, string | undefined>> = []): FontePedidos => ({
    listPage: async (page, filtro) => {
      vistos.push(filtro);
      return { items: paginas[page - 1] ?? [], nextPage: page < paginas.length ? page + 1 : null, invalidos: 0, campos: ["id", "products"] };
    },
  });

  it("lê as páginas, marca a sincronização, refaz o resumo por produto e depois fica incremental", async () => {
    const vistos: Array<Record<string, string | undefined>> = [];
    const p = await passoPedidos(db, fonte([[pedido(1, [{ product_id: 10, quantity: 2, price: "50" }])], [pedido(2, [{ product_id: 10, quantity: 1, price: "50" }, { product_id: 11, quantity: 1, price: "30" }])]], vistos), { storeId, budgetMs: 10_000 });
    expect(p).toMatchObject({ concluido: true, proxima: null, lidos: 2, novos: 2, itens: 3, incremental: false, campos: ["id", "products"] });
    expect(vistos[0]!.criadosDesde).toBeTruthy();
    expect(vistos[0]!.atualizadosDesde).toBeUndefined();
    expect(await ultimaSincronizacaoPedidos(db, storeId)).not.toBeNull();

    const vendas = (await pg.query<{ product_id: string; units: number; orders: number }>("SELECT product_id::text, units, orders FROM product_sales ORDER BY product_id")).rows;
    expect(vendas).toEqual([{ product_id: "10", units: 3, orders: 2 }, { product_id: "11", units: 1, orders: 1 }]);
    expect((await resumoVendas(db, storeId)).janelaDias).toBe(365);

    // segunda leitura: incremental; o pedido 1 foi cancelado e some do resumo
    const q = await passoPedidos(db, fonte([[pedido(1, [{ product_id: 10, quantity: 2, price: "50" }], { status: "cancelled" })]], vistos), { storeId, budgetMs: 10_000 });
    expect(q.incremental).toBe(true);
    expect(vistos.at(-1)!.atualizadosDesde).toBeTruthy();
    expect(vistos.at(-1)!.criadosDesde).toBeUndefined();
    expect((await pg.query<{ units: number }>("SELECT units FROM product_sales WHERE product_id = 10")).rows[0]!.units).toBe(1);

    const full = await passoPedidos(db, fonte([[]], vistos), { storeId, completo: true, budgetMs: 10_000 });
    expect(full.incremental).toBe(false);
  });

  it("para ao estourar o tempo, devolve a próxima página e só marca a sincronização no fim", async () => {
    const paginas = [[pedido(1, [{ product_id: 10, quantity: 1, price: "10" }])], [pedido(2, [{ product_id: 10, quantity: 1, price: "10" }])], [pedido(3, [{ product_id: 10, quantity: 1, price: "10" }])]];
    let t = 0;
    const a = await passoPedidos(db, fonte(paginas), { storeId, budgetMs: 5, now: () => (t += 10) });
    expect(a).toMatchObject({ concluido: false, proxima: 2 });
    expect(await ultimaSincronizacaoPedidos(db, storeId)).toBeNull();
    const b = await passoPedidos(db, fonte(paginas), { storeId, page: 2, inicio: a.inicio, budgetMs: 10_000 });
    expect(b.concluido).toBe(true);
    expect((await pg.query("SELECT 1 FROM orders")).rows).toHaveLength(3);
  });

  it("ignora pedido sem data válida e conta", async () => {
    const p = await passoPedidos(db, fonte([[pedido(1, [], { created_at: "x" }), pedido(2, [{ product_id: 10, quantity: 1, price: "10" }])]]), { storeId, budgetMs: 10_000 });
    expect(p).toMatchObject({ lidos: 2, ignorados: 1, novos: 1 });
  });

  it("reconstruirVendas devolve quantos produtos tiveram venda", async () => {
    await gravarPedidos(db, storeId, mapear([pedido(1, [{ product_id: 10, quantity: 1, price: "10" }, { product_id: 11, quantity: 1, price: "10" }])]));
    expect(await reconstruirVendas(db, storeId)).toBe(2);
  });
});

const cat = (id: number, nome: string): Category => ({ id, name: { pt: nome } }) as unknown as Category;
const produto = (id: number, nome: string, cats: number[], extra: Record<string, unknown> = {}): Product =>
  ({
    id,
    name: { pt: nome },
    published: true,
    categories: cats.map((c) => ({ id: c, name: { pt: `C${c}` } })),
    attributes: [{ pt: "Cor" }, { pt: "Tamanho" }],
    images: [{ id: id * 10, product_id: id, src: `https://x/${id}.jpg`, position: 1 }],
    variants: [
      { id: id * 100, product_id: id, price: "100.00", stock_management: true, stock: 4, values: [{ pt: "azul" }, { pt: "p" }] },
      { id: id * 100 + 1, product_id: id, price: "100.00", stock_management: true, stock: 0, values: [{ pt: "ROSA" }, { pt: "m" }] },
    ],
    updated_at: "2026-10-01T10:00:00+0000",
    ...extra,
  }) as unknown as Product;

describe("painel de vendas", () => {
  const hoje = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
  const { atual, anterior } = periodos(hoje, 7);

  beforeEach(async () => {
    await upsertCategories(db, storeId, [cat(1, "Vestidos"), cat(2, "Saias")]);
    await upsertProducts(db, storeId, [produto(10, "Vestido Azul", [1, 2]), produto(11, "Saia Rosa", [2])]);
    await gravarPedidos(
      db,
      storeId,
      mapear([
        pedido(1, [{ product_id: 10, variant_id: 1000, quantity: 2, price: "100", variant_values: ["Azul", "P"] }], { total: "210.00", created_at: diaAtras(1) }),
        pedido(2, [{ product_id: 10, variant_id: 1001, quantity: 1, price: "100" }, { product_id: 11, variant_id: 9999, quantity: 3, price: "50" }], { total: "250.00", created_at: diaAtras(2) }),
        pedido(3, [{ product_id: 11, quantity: 9, price: "50" }], { status: "cancelled", total: "450.00", created_at: diaAtras(1) }),
        pedido(4, [{ product_id: 11, quantity: 9, price: "50" }], { payment_status: "pending", total: "450.00", created_at: diaAtras(1) }),
        pedido(5, [{ product_id: 10, quantity: 4, price: "100" }], { total: "400.00", created_at: diaAtras(9) }), // período anterior
      ]),
    );
  });

  it("períodos: o atual termina hoje e o anterior tem o mesmo tamanho logo antes", () => {
    expect(somarDias("2026-03-01", -1)).toBe("2026-02-28");
    const p = periodos("2026-10-10", 7);
    expect(p.atual).toEqual({ de: "2026-10-04", ate: "2026-10-10" });
    expect(p.anterior).toEqual({ de: "2026-09-27", ate: "2026-10-03" });
  });

  it("resumo do período conta só pedidos pagos e não cancelados", async () => {
    expect(await resumoDoPeriodo(db, storeId, atual)).toEqual({ pedidos: 2, faturamento: 460, unidades: 6, ticket: 230 });
    expect(await resumoDoPeriodo(db, storeId, anterior)).toMatchObject({ pedidos: 1, faturamento: 400, unidades: 4 });
  });

  it("faturamento por dia preenche os dias sem venda com zero", async () => {
    const dias = await vendasPorDia(db, storeId, atual);
    expect(dias).toHaveLength(7);
    expect(dias.reduce((s, d) => s + d.faturamento, 0)).toBe(460);
    expect(dias.filter((d) => d.pedidos === 0).length).toBe(5);
  });

  it("mais vendidos por peças e por valor, com foto e estoque", async () => {
    const porPecas = await maisVendidos(db, storeId, atual, "unidades", 10);
    expect(porPecas.map((p) => [p.product_id, p.unidades])).toEqual([["11", 3], ["10", 3]].sort((a, b) => (a[0] as string).localeCompare(b[0] as string)).sort((a, b) => Number(b[1]) - Number(a[1])));
    const porValor = await maisVendidos(db, storeId, atual, "valor", 10);
    expect(porValor[0]).toMatchObject({ product_id: "10", nome: "Vestido Azul", valor: 300, unidades: 3, pedidos: 2, estoque: 4, foto: "https://x/10.jpg" });
    expect(porValor[1]).toMatchObject({ product_id: "11", valor: 150 });
  });

  it("por categoria (produto em duas categorias conta nas duas)", async () => {
    const c = await porCategoria(db, storeId, atual);
    expect(c.find((x) => x.nome === "Vestidos")).toMatchObject({ unidades: 3, valor: 300 });
    expect(c.find((x) => x.nome === "Saias")).toMatchObject({ unidades: 6, valor: 450 });
  });

  it("por cor e tamanho: usa os valores da linha do pedido ou, na falta, os da variação do espelho", async () => {
    const r = await porCorETamanho(db, storeId, atual);
    // pedido 1 (linha): Azul/P x2; pedido 2: variação 1001 do espelho = Rosa/M x1; variação 9999 não existe no espelho -> sem dado (3 peças)
    expect(r.cores.map((c) => [c.nome, c.unidades])).toEqual(expect.arrayContaining([["Azul", 2], ["Rosa", 1]]));
    expect(r.tamanhos.map((c) => [c.nome, c.unidades])).toEqual(expect.arrayContaining([["P", 2], ["M", 1]]));
    expect(r.semDado).toBe(3);
  });

  it("cobertura dos pedidos e privacidade (customers/redact zera o cliente do pedido, mantém a venda)", async () => {
    const c = await coberturaDosPedidos(db, storeId);
    expect(c.total).toBe(5);
    expect(c.primeiro! < c.ultimo!).toBe(true);
    expect(await redactCustomer(db, 77, 5)).toBe(0); // não há cliente espelhado, mas os pedidos são anonimizados
    expect((await pg.query("SELECT 1 FROM orders WHERE customer_id IS NOT NULL")).rows).toHaveLength(0);
    expect((await pg.query("SELECT 1 FROM orders")).rows).toHaveLength(5);
  });

  it("planilha de produtos vendidos", async () => {
    const itens = await maisVendidos(db, storeId, atual, "valor", 10);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await gerarXlsx("Produtos vendidos", COLUNAS_VENDAS, itens)) as never);
    const ws = wb.getWorksheet("Produtos vendidos")!;
    expect((ws.getRow(1).values as string[]).slice(1, 5)).toEqual(["ID do produto", "Produto", "Peças vendidas", "Valor vendido (R$)"]);
    expect((ws.getRow(2).values as unknown[]).slice(1, 7)).toEqual(["10", "Vestido Azul", 3, 300, 2, 4]);
  });
});
