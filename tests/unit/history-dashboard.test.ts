import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import { upsertCategories, upsertProducts, type Db } from "@/lib/sync/repo";
import { HISTORY_PAGE_SIZE, listHistory } from "@/lib/history/query";
import { acaoLabel } from "@/lib/history/labels";
import { getCatalogStats } from "@/lib/dashboard/stats";
import { listCatalog } from "@/lib/catalog/query";
import { catalogParamsSchema, filtersQueryString, paramsToFilters } from "@/lib/catalog/params";
import type { Category, Product, Variant } from "@/lib/nuvemshop/types";

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

const variant = (id: number, productId: number, over: Partial<Variant> = {}): Variant => ({ id, product_id: productId, sku: `S${id}`, price: "10.00", stock_management: true, stock: 5, ...over });
const product = (id: number, over: Partial<Product> = {}): Product => ({
  id,
  name: { pt: `Produto ${id}` },
  description: { pt: "<p>desc</p>" },
  published: true,
  categories: [{ id: 1, name: { pt: "Cat" } }],
  images: [{ id: id * 10, product_id: id, src: "https://x/a.jpg" }],
  variants: [variant(id * 10, id)],
  ...over,
});

describe("indicadores do catálogo e filtros correspondentes", () => {
  beforeEach(async () => {
    await upsertCategories(db, storeId, [{ id: 1, name: { pt: "Cat" } }] as Category[]);
    await upsertProducts(db, storeId, [
      product(1), // tudo certo
      product(2, { published: false, images: [] }), // sem imagem, não publicado
      product(3, { categories: [], description: { pt: "  " } }), // sem categoria e sem descrição
      product(4, { variants: [variant(40, 4, { sku: "", stock: 0 }), variant(41, 4)] }), // variante sem SKU e sem estoque
      product(5, { variants: [variant(50, 5, { stock_management: false, stock: null })] }), // sem controle: não conta como sem estoque
    ]);
  });

  it("conta cada indicador", async () => {
    expect(await getCatalogStats(db, storeId)).toEqual({
      produtos: 5, publicados: 4, naoPublicados: 1, variantes: 6, categorias: 1,
      semImagem: 1, semCategoria: 1, semSku: 1, semEstoque: 1, semDescricao: 1,
    });
  });

  it("cada indicador bate com o filtro da lista (o link do painel mostra exatamente aqueles produtos)", async () => {
    const ids = async (q: Record<string, string>) => (await listCatalog(db, storeId, paramsToFilters(catalogParamsSchema.parse(q)))).items.map((i) => i.id).sort();
    expect(await ids({ sem_imagem: "1" })).toEqual(["2"]);
    expect(await ids({ sem_categoria: "1" })).toEqual(["3"]);
    expect(await ids({ sem_sku: "1" })).toEqual(["4"]);
    expect(await ids({ sem_estoque: "1" })).toEqual(["4"]);
    expect(await ids({ sem_descricao: "1" })).toEqual(["3"]);
    expect(await ids({ sem_imagem: "1", sem_categoria: "1" })).toEqual([]); // filtros se combinam (E)
    expect(filtersQueryString(catalogParamsSchema.parse({ sem_imagem: "1", sem_estoque: "1", ordem: "nome", pagina: "3" }))).toBe("sem_imagem=1&sem_estoque=1");
  });

  it("estoque zerado ignora variante sem controle de estoque", async () => {
    await upsertProducts(db, storeId, [product(6, { variants: [variant(60, 6, { stock_management: false, stock: 0 })] })]);
    expect((await getCatalogStats(db, storeId)).semEstoque).toBe(1);
  });
});

describe("histórico", () => {
  const log = async (acao: string, entidade: string, id: string | null, over: { sucesso?: boolean; actor?: string; at?: string } = {}) =>
    pg.query(
      `INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, antes, depois, sucesso, created_at)
       VALUES ($1, $2, $3, $4, $5, '{"a":1}'::jsonb, '{"a":2}'::jsonb, $6, coalesce($7::timestamptz, now()))`,
      [storeId, over.actor ?? "admin@example.com", acao, entidade, id, over.sucesso ?? true, over.at ?? null],
    );

  beforeEach(async () => {
    await upsertCategories(db, storeId, [{ id: 7, name: { pt: "Vestidos" } }] as Category[]);
    await upsertProducts(db, storeId, [product(1), product(2, { variants: [variant(20, 2)] })]);
    const job = (await pg.query<{ id: string }>("INSERT INTO bulk_jobs (store_id, actor_email, operation, descricao) VALUES ($1, 'a@a', '{}'::jsonb, 'Aumentar o preço em 10%') RETURNING id", [storeId])).rows[0]!.id;
    await log("produto.atualizar", "produto", "1", { at: "2026-10-01T10:00:00Z" });
    await log("variante.atualizar", "variante", "20", { at: "2026-10-01T11:00:00Z" });
    await log("imagem.adicionar", "produto", "2", { at: "2026-10-01T12:00:00Z", sucesso: false });
    await log("categoria.criar", "categoria", "7", { at: "2026-10-01T13:00:00Z" });
    await log("lote.criar", "lote", job, { at: "2026-10-01T14:00:00Z" });
    await log("lote.preco", "produto", "1", { at: "2026-10-01T15:00:00Z" });
    await log("produto.atualizar", "produto", "999", { at: "2026-10-01T16:00:00Z" }); // produto que não existe mais
  });

  it("lista da mais recente para a mais antiga e resolve os nomes", async () => {
    const r = await listHistory(db, storeId);
    expect(r.total).toBe(7);
    expect(r.items.map((i) => i.acao)).toEqual(["produto.atualizar", "lote.preco", "lote.criar", "categoria.criar", "imagem.adicionar", "variante.atualizar", "produto.atualizar"]);
    expect(r.items.map((i) => i.nome)).toEqual([null, "Produto 1", "Aumentar o preço em 10%", "Vestidos", "Produto 2", "Produto 2", "Produto 1"]);
    expect(r.items[0]).toMatchObject({ produto_id: null, entidade_id: "999" });
    expect(r.items[5]).toMatchObject({ nome: "Produto 2", produto_id: "2", antes: { a: 1 }, depois: { a: 2 } }); // variante resolve o produto
  });

  it("filtra por tipo, só falhas e produto (inclui variantes e lotes por produto)", async () => {
    expect((await listHistory(db, storeId, { tipo: "lote" })).items.map((i) => i.acao)).toEqual(["lote.preco", "lote.criar"]);
    expect((await listHistory(db, storeId, { tipo: "imagem" })).total).toBe(1);
    expect((await listHistory(db, storeId, { falhas: true })).items.map((i) => i.acao)).toEqual(["imagem.adicionar"]);
    expect((await listHistory(db, storeId, { produto: 2 })).items.map((i) => i.acao)).toEqual(["imagem.adicionar", "variante.atualizar"]);
    expect((await listHistory(db, storeId, { produto: 1 })).items.map((i) => i.acao)).toEqual(["lote.preco", "produto.atualizar"]);
    expect((await listHistory(db, storeId, { produto: 2, tipo: "variante" })).total).toBe(1);
  });

  it("pagina e não mistura lojas", async () => {
    for (let i = 0; i < HISTORY_PAGE_SIZE + 3; i++) await log("produto.atualizar", "produto", "1");
    const p1 = await listHistory(db, storeId, { page: 1 });
    const p2 = await listHistory(db, storeId, { page: 2 });
    expect(p1.items).toHaveLength(HISTORY_PAGE_SIZE);
    expect(p1.pages).toBe(2);
    expect(p2.items).toHaveLength(7 + 3);
    expect((await listHistory(db, storeId, { page: 99 })).page).toBe(2);
    const other = (await pg.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (2, 'y') RETURNING id")).rows[0]!.id;
    expect((await listHistory(db, other)).total).toBe(0);
  });

  it("traduz as ações para português", () => {
    expect(acaoLabel("produto.atualizar")).toBe("Produto editado");
    expect(acaoLabel("lote.preco", "produto")).toBe("Lote: preço aplicado ao produto");
    expect(acaoLabel("lote.reverter", "lote")).toBe("Lote de reversão criado");
    expect(acaoLabel("lote.reverter", "produto")).toBe("Lote: reversão aplicada ao produto");
    expect(acaoLabel("coisa.nova")).toBe("coisa.nova");
  });
});
