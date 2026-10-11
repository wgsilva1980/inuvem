import { beforeEach, describe, expect, it } from "vitest";
import JSZip from "jszip";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import { upsertCategories, upsertProducts, type Db } from "@/lib/sync/repo";
import type { Order } from "@/lib/nuvemshop/orders";
import type { Product, Variant } from "@/lib/nuvemshop/types";
import { mapearPedido } from "@/lib/orders/map";
import { gravarPedidos } from "@/lib/orders/sync";
import { celula, csv } from "@/lib/backup/csv";
import { montarZip } from "@/lib/backup/zip";
import { montarBackup } from "@/lib/backup/montar";
import { acaoLabel } from "@/lib/history/labels";

describe("CSV", () => {
  it("separa por ponto e vírgula, com BOM, aspas e vírgula decimal", () => {
    expect(csv(["A", "B"], [["x;y", 12.5], ['diz "oi"', null]])).toBe('﻿A;B\r\n"x;y";12,5\r\n"diz ""oi""";\r\n');
    expect(celula(true)).toBe("true");
    expect(celula(new Date("2026-10-10T00:00:00Z"))).toBe("2026-10-10T00:00:00.000Z");
  });

  it("neutraliza fórmulas do Excel em texto vindo da loja ou de clientes", () => {
    for (const ruim of ["=HYPERLINK(\"http://x\")", "+1+1", "-2+3", "@SOMA(A1)", "\tcmd"]) expect(celula(ruim).startsWith("'") || celula(ruim).startsWith("\"'")).toBe(true);
    expect(celula("Vestido -azul")).toBe("Vestido -azul");
    expect(celula(-5)).toBe("-5"); // número de verdade não leva apóstrofo
  });
});

describe("ZIP", () => {
  it("gera um arquivo que um leitor de ZIP abre, com nomes e acentos preservados e CRC conferido", async () => {
    const grande = "linha com acentuação: ação, coração\n".repeat(5000);
    const zip = montarZip([{ nome: "LEIAME.txt", conteudo: "Olá, mundo" }, { nome: "dados/grande.json", conteudo: grande }, { nome: "planilhas/vazio.csv", conteudo: "" }, { nome: "bin.dat", conteudo: Buffer.from([0, 1, 2, 255]) }]);
    expect(zip.length).toBeLessThan(grande.length / 5); // comprimiu
    const lido = await JSZip.loadAsync(zip, { checkCRC32: true });
    expect(Object.keys(lido.files).sort()).toEqual(["LEIAME.txt", "bin.dat", "dados/grande.json", "planilhas/vazio.csv"]);
    expect(await lido.file("LEIAME.txt")!.async("string")).toBe("Olá, mundo");
    expect(await lido.file("dados/grande.json")!.async("string")).toBe(grande);
    expect(await lido.file("planilhas/vazio.csv")!.async("string")).toBe("");
    expect([...(await lido.file("bin.dat")!.async("uint8array"))]).toEqual([0, 1, 2, 255]);
  });

  it("sem arquivos ainda é um ZIP válido", async () => {
    expect(Object.keys((await JSZip.loadAsync(montarZip([]))).files)).toEqual([]);
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
});

const variante = (id: number, over: Partial<Variant> = {}): Variant => ({ id, product_id: 1, sku: `SKU-${id}`, price: "100.00", stock_management: true, stock: 10, values: [{ pt: "Azul" }, { pt: "M" }], ...over });
async function semear() {
  await upsertCategories(db, storeId, [{ id: 10, name: { pt: "Vestidos" } }]);
  await upsertProducts(db, storeId, [{ id: 1, name: { pt: "Vestido Midi" }, published: true, categories: [{ id: 10, name: { pt: "Vestidos" } }], images: [], variants: [variante(100), variante(101, { sku: "=CMD()", stock: 0 })], attributes: [{ pt: "COR" }, { pt: "TAMANHO" }], updated_at: "2026-10-01T10:00:00+0000" } as unknown as Product]);
  await pg.query("INSERT INTO product_costs (store_id, product_id, cost, source) VALUES ($1, 1, 42.5, 'manual')", [storeId]);
  await pg.query("INSERT INTO content_blocks (store_id, name, html) VALUES ($1, 'Aviso de troca', '<p>Troca em 7 dias</p>')", [storeId]);
  await pg.query("INSERT INTO purchase_orders (store_id, supplier) VALUES ($1, 'Malharia Sol')", [storeId]);
  await pg.query("INSERT INTO purchase_order_items (order_id, seq, product_id, variant_id, product_name, variation, qty) SELECT id, 1, 1, 100, 'Vestido Midi', 'Azul / M', 5 FROM purchase_orders");
  await pg.query("INSERT INTO cost_settings (store_id, min_margin) VALUES ($1, 20)", [storeId]);
  await gravarPedidos(db, storeId, [{ id: 7, number: 1007, created_at: "2026-10-05T10:00:00Z", total: "200", discount: "0", status: "open", payment_status: "paid", shipping_status: "unpacked", customer: { id: 55, name: "Ana Souza", email: "ana@x.com", phone: "11912345678" }, products: [{ product_id: 1, variant_id: 100, quantity: 2, price: "100" }] } as unknown as Order].map(mapearPedido).filter((m): m is NonNullable<typeof m> => m !== null));
  await pg.query("INSERT INTO customers (store_id, id, name, email, phone, document, city, state, total_spent, accepts_marketing) VALUES ($1, 55, 'Ana Souza', 'ana@x.com', '11912345678', '12345678901', 'Belo Horizonte', 'MG', 200, true)", [storeId]);
}
const abrir = async (zip: Buffer) => JSZip.loadAsync(zip, { checkCRC32: true });
const AGORA = new Date("2026-10-11T15:00:00Z");

describe("montar o backup", () => {
  it("reúne catálogo, custos, blocos, compras, configurações e pedidos; sem dados pessoais por padrão", async () => {
    await semear();
    const { zip, resumo, nomeSugerido } = await montarBackup(db, { storeId, nomeDaLoja: "Donatelle Concept", opcoes: { incluirClientes: false }, agora: AGORA });
    expect(nomeSugerido).toBe("backup-inuvem-2026-10-11.zip");
    expect(resumo).toMatchObject({ produtos: 1, variacoes: 2, categorias: 1, pedidos: 1, clientes: null, custos: 1, blocos: 1, pedidosDeCompra: 1, arquivos: 11 });
    expect(resumo.bytes).toBe(zip.length);
    const z = await abrir(zip);
    expect(Object.keys(z.files).sort()).toEqual([
      "LEIAME.txt", "dados/blocos-de-conteudo.json", "dados/categorias.json", "dados/configuracoes.json", "dados/custos-dos-produtos.json", "dados/pedidos-de-compra.json", "dados/produtos.json",
      "planilhas/catalogo.xlsx", "planilhas/custos.csv", "planilhas/itens-dos-pedidos.csv", "planilhas/pedidos.csv",
    ]);
    const produtos = JSON.parse(await z.file("dados/produtos.json")!.async("string")) as Array<{ id: number; variants: Array<{ id: number; sku: string }> }>;
    expect(produtos).toHaveLength(1);
    expect(produtos[0]!.variants.map((v) => v.id)).toEqual([100, 101]);
    expect(JSON.parse(await z.file("dados/custos-dos-produtos.json")!.async("string"))).toEqual([{ produto_id: "1", produto: "Vestido Midi", custo: 42.5, origem: "manual" }]);
    expect(JSON.parse(await z.file("dados/blocos-de-conteudo.json")!.async("string"))[0]).toMatchObject({ name: "Aviso de troca", html: "<p>Troca em 7 dias</p>" });
    const compras = JSON.parse(await z.file("dados/pedidos-de-compra.json")!.async("string")) as Array<{ supplier: string; itens: unknown[] }>;
    expect(compras).toMatchObject([{ supplier: "Malharia Sol" }]);
    expect(compras[0]!.itens).toHaveLength(1);
    expect(JSON.parse(await z.file("dados/configuracoes.json")!.async("string"))).toMatchObject({ custos: { margem_minima: "20.00" }, cashback: null, selos: null });
    const pedidos = await z.file("planilhas/pedidos.csv")!.async("string");
    expect(pedidos).toMatch(/1007;/);
    expect(pedidos).toMatch(/;55\r\n/); // só o ID do cliente
    const tudo = (await Promise.all(Object.keys(z.files).filter((n) => !n.endsWith(".xlsx")).map((n) => z.file(n)!.async("string")))).join("\n");
    expect(tudo).not.toMatch(/Ana Souza|ana@x\.com|11912345678|12345678901/); // nenhum dado pessoal sem pedir
    const leiame = await z.file("LEIAME.txt")!.async("string");
    expect(leiame).toMatch(/Donatelle Concept/);
    expect(leiame).toMatch(/1 produtos, 2 variações/);
    expect(leiame).toMatch(/Dados pessoais de clientes NÃO foram incluídos/);
  });

  it("o catálogo em planilha traz preço, estoque e custo e protege texto que parece fórmula", async () => {
    await semear();
    const z = await abrir((await montarBackup(db, { storeId, nomeDaLoja: null, opcoes: { incluirClientes: false }, agora: AGORA })).zip);
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await z.file("planilhas/catalogo.xlsx")!.async("nodebuffer")) as never);
    const ws = wb.worksheets[0]!;
    expect(ws.rowCount).toBe(3);
    const l2 = ws.getRow(2).values as unknown[];
    expect(l2).toEqual(expect.arrayContaining(["Vestido Midi", "Sim", "Vestidos", "SKU-100", "Azul / M", 100, 10, 42.5]));
  });

  it("com clientes: inclui a planilha (sem CPF), avisa no LEIAME e conta", async () => {
    await semear();
    const { zip, resumo } = await montarBackup(db, { storeId, nomeDaLoja: null, opcoes: { incluirClientes: true }, agora: AGORA });
    expect(resumo.clientes).toBe(1);
    const z = await abrir(zip);
    const clientes = await z.file("planilhas/clientes.csv")!.async("string");
    expect(clientes).toMatch(/Ana Souza;ana@x\.com;11912345678;Belo Horizonte;MG;200;Sim/);
    expect(clientes).not.toMatch(/12345678901/); // CPF nunca entra
    expect(await z.file("LEIAME.txt")!.async("string")).toMatch(/DADOS PESSOAIS/);
  });

  it("loja vazia gera um backup válido", async () => {
    const { zip, resumo } = await montarBackup(db, { storeId, nomeDaLoja: null, opcoes: { incluirClientes: false }, agora: AGORA });
    expect(resumo).toMatchObject({ produtos: 0, variacoes: 0, pedidos: 0 });
    const z = await abrir(zip);
    expect(JSON.parse(await z.file("dados/produtos.json")!.async("string"))).toEqual([]);
    expect(acaoLabel("backup.gerar")).toMatch(/Backup/);
  });
});
