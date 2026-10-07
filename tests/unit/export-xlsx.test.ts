import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import { upsertCategories, upsertProducts, type Db } from "@/lib/sync/repo";
import { listarProdutosParaExportar } from "@/lib/catalog/export";
import { createContact, listContactsForExport } from "@/lib/contacts/repo";
import { COLUNAS_CONTATOS, COLUNAS_PRODUTOS } from "@/lib/export/colunas";
import { gerarXlsx } from "@/lib/export/xlsx";
import type { Product } from "@/lib/nuvemshop/types";

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
  storeId = (await pg.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (1, 'x') RETURNING id")).rows[0]!.id;
});

const prod = (id: number, over: Partial<Product> = {}): Product => ({
  id,
  name: { pt: `Produto ${id}` },
  description: { pt: "d" },
  handle: { pt: `p-${id}` },
  published: true,
  categories: [{ id: 10, name: { pt: "Vestidos" } }],
  images: [],
  variants: [
    { id: id * 100 + 1, product_id: id, sku: `S${id}-P`, price: "100.00", stock: 3, stock_management: true, values: [{ pt: "P" }, { pt: "Azul" }] },
    { id: id * 100 + 2, product_id: id, sku: `S${id}-M`, price: "100.00", stock: null, stock_management: false, values: [{ pt: "M" }, { pt: "Azul" }] },
  ],
  updated_at: "2026-10-01T10:00:00+0000",
  ...over,
});

async function ler(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as never);
  return wb.worksheets[0]!;
}

describe("exportar produtos", () => {
  beforeEach(async () => {
    await upsertCategories(db, storeId, [{ id: 10, name: { pt: "Vestidos" } }]);
    await upsertProducts(db, storeId, [prod(1, { name: { pt: "Vestido" } }), prod(2, { name: { pt: "Blusa" }, published: false }), prod(3, { name: { pt: "=Saia" } })]);
  });

  it("gera uma linha por variação, na ordem da lista, com cabeçalho", async () => {
    const { linhas, truncado } = await listarProdutosParaExportar(db, storeId, {});
    expect(truncado).toBe(false);
    expect(linhas).toHaveLength(6);
    expect(linhas[0]).toMatchObject({ produto: "=Saia", variacao: "P / Azul", categorias: "Vestidos" });
    const ws = await ler(await gerarXlsx("Produtos", COLUNAS_PRODUTOS, linhas));
    expect(ws.getRow(1).getCell(2).value).toBe("Produto");
    expect(ws.rowCount).toBe(7);
    expect(ws.getRow(2).getCell(2).value).toBe("=Saia");
  });

  it("respeita os filtros da tela", async () => {
    const pub = await listarProdutosParaExportar(db, storeId, { status: "publicados" });
    expect(new Set(pub.linhas.map((l) => l.produto))).toEqual(new Set(["Vestido", "=Saia"]));
    const busca = await listarProdutosParaExportar(db, storeId, { q: "S2-M" });
    expect(busca.linhas.map((l) => l.produto_id)).toEqual(["2", "2"]);
  });

  it("estoque só aparece quando é controlado", async () => {
    const { linhas } = await listarProdutosParaExportar(db, storeId, { q: "Vestido" });
    const ws = await ler(await gerarXlsx("Produtos", COLUNAS_PRODUTOS, linhas));
    const idx = COLUNAS_PRODUTOS.findIndex((c) => c.titulo === "Estoque") + 1;
    expect(ws.getRow(2).getCell(idx).value).toBe(3);
    expect(ws.getRow(3).getCell(idx).value).toBeNull();
  });
});

describe("exportar contatos", () => {
  it("exporta todos os que casam com o filtro, sem paginar", async () => {
    const base = { kind: null, person_type: "fisica" as const, ie_exempt: false, active: true } as never;
    for (let i = 0; i < 30; i++) await createContact(db, { storeId, actor: "a@b.c", input: { ...(base as object), name: `Cliente ${String(i).padStart(2, "0")}`, kind: "cliente" } as never });
    await createContact(db, { storeId, actor: "a@b.c", input: { ...(base as object), name: "Fornecedor X", kind: "fornecedor" } as never });
    const { items, truncated } = await listContactsForExport(db, storeId, { kind: "cliente", status: "ativos" }, 100);
    expect(items).toHaveLength(30);
    expect(truncated).toBe(false);
    const cortado = await listContactsForExport(db, storeId, {}, 10);
    expect(cortado.items).toHaveLength(10);
    expect(cortado.truncated).toBe(true);
    const ws = await ler(await gerarXlsx("Contatos", COLUNAS_CONTATOS, items));
    expect(ws.rowCount).toBe(31);
    expect(ws.getRow(1).getCell(1).value).toBe("Nome");
  });
});
