import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import type { Db } from "@/lib/sync/repo";
import { FAIXAS, faixaDaNota, notaDoChecklist, relatorioDeQualidade } from "@/lib/catalog/qualidade";
import type { Checklist, ItemChecklist } from "@/lib/catalog/readiness";

const item = (obrigatorio: boolean, status: ItemChecklist["status"]): ItemChecklist => ({ chave: "x", rotulo: "x", obrigatorio, status, detalhe: "" });
const lista = (itens: ItemChecklist[]) => ({ itens }) as unknown as Checklist;

describe("nota do checklist", () => {
  it("obrigatório pesa 3 e recomendado 1; info não conta", () => {
    expect(notaDoChecklist(lista([item(true, "ok"), item(false, "ok")]))).toBe(100);
    expect(notaDoChecklist(lista([item(true, "falta"), item(false, "ok")]))).toBe(25); // 1 de 4
    expect(notaDoChecklist(lista([item(true, "ok"), item(false, "atencao")]))).toBe(75); // 3 de 4
    expect(notaDoChecklist(lista([item(true, "ok"), item(false, "info")]))).toBe(100);
    expect(notaDoChecklist(lista([]))).toBe(100);
  });

  it("faixas", () => {
    expect(FAIXAS.map((f) => f.faixa)).toEqual(["otimo", "bom", "regular", "fraco"]);
    expect([100, 90, 89, 70, 69, 50, 49, 0].map(faixaDaNota)).toEqual(["otimo", "otimo", "bom", "bom", "regular", "regular", "fraco", "fraco"]);
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

const DESC = "<p>" + "Vestido midi em viscose com caimento leve, ideal para o dia a dia e para ocasiões especiais. ".repeat(2) + "</p>";
async function produto(id: number, nome: string, o: { publicado?: boolean; fotos?: number; descricao?: string | null; categoria?: boolean; seoTitulo?: string; seoDescricao?: string; tags?: string } = {}) {
  await pg.query(
    "INSERT INTO products (store_id, id, name, description, published, categories, tags, image_count, raw_json) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::jsonb)",
    [
      storeId, id, nome, o.descricao === undefined ? DESC : o.descricao, o.publicado ?? true,
      JSON.stringify(o.categoria === false ? [] : [{ id: 1, name: "Vestidos" }]), o.tags ?? "vestido, midi", o.fotos ?? 4,
      JSON.stringify({ seo_title: { pt: o.seoTitulo ?? "Vestido Midi Feminino em Viscose | Donatelle Concept" }, seo_description: { pt: o.seoDescricao ?? "Vestido midi feminino em viscose, leve e confortável, para o dia a dia e ocasiões especiais. Confira na Donatelle Concept." }, attributes: [{ pt: "COR" }, { pt: "TAMANHO" }] }),
    ],
  );
}
let seq = 100;
async function variante(produtoId: number, o: { sku?: string | null; preco?: string | null; promo?: string | null; estoque?: number | null; controla?: boolean } = {}) {
  await pg.query(
    "INSERT INTO variants (store_id, id, product_id, sku, price, promotional_price, stock, stock_management, weight, width, height, depth, values, raw_json) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0.3, 20, 5, 30, $9::jsonb, $10::jsonb)",
    [storeId, seq++, produtoId, o.sku === undefined ? `SKU-${seq}` : o.sku, o.preco === undefined ? "100.00" : o.preco, o.promo ?? null, o.estoque === undefined ? 5 : o.estoque, o.controla ?? true, JSON.stringify([{ pt: "Azul" }, { pt: "M" }]), JSON.stringify({ gender: "female", age_group: "adult" })],
  );
}

describe("relatório de qualidade do catálogo", () => {
  it("catálogo vazio não quebra", async () => {
    expect(await relatorioDeQualidade(db, storeId)).toMatchObject({ produtos: [], notaMedia: 0, prontos: 0 });
  });

  it("um produto completo tira 100; um incompleto tira menos e vem primeiro, com os problemas", async () => {
    await produto(1, "Vestido Completo");
    await variante(1);
    await produto(2, "Vestido Fraco", { fotos: 0, descricao: null, categoria: false, seoTitulo: "", seoDescricao: "", tags: "" });
    await variante(2, { sku: null, preco: null, estoque: 0 });
    const r = await relatorioDeQualidade(db, storeId);
    expect(r.produtos.map((p) => p.nome)).toEqual(["Vestido Fraco", "Vestido Completo"]);
    expect(r.produtos[1]).toMatchObject({ nota: 100, pronto: true, problemas: [] });
    const fraco = r.produtos[0]!;
    expect(fraco.nota).toBeLessThan(30);
    expect(fraco.pronto).toBe(false);
    expect(fraco.problemas.map((p) => p.chave)).toEqual(expect.arrayContaining(["foto", "preco", "categoria", "descricao", "estoque", "seo_titulo", "seo_descricao", "sku", "tags"]));
    expect(r.prontos).toBe(1);
    expect(r.notaMedia).toBe(Math.round((100 + fraco.nota) / 2));
    expect(r.porFaixa).toEqual({ otimo: 1, bom: 0, regular: 0, fraco: 1 });
    // contagem por problema: obrigatórios primeiro
    expect(r.porProblema[0]!.obrigatorio).toBe(true);
    expect(r.porProblema.find((p) => p.chave === "seo_titulo")).toMatchObject({ produtos: 1, obrigatorio: false });
  });

  it("entre produtos: SKU repetido, nome repetido, promoção sem desconto, preços dispares e prontos não publicados", async () => {
    await produto(1, "Vestido Azul");
    await variante(1, { sku: "AZ-1" });
    await variante(1, { sku: "AZ-1" }); // mesmo SKU duas vezes no mesmo produto
    await produto(2, "vestido  azul", { publicado: false }); // nome repetido (acento, caixa e espaços), pronto e escondido
    await variante(2, { sku: "AZ-1" }); // e o SKU repete em outro produto
    await produto(3, "Saia", {});
    await variante(3, { sku: "S-1", preco: "100.00", promo: "100.00" }); // sem desconto
    await produto(4, "Blusa");
    await variante(4, { sku: "B-1", preco: "50.00" });
    await variante(4, { sku: "B-2", preco: "400.00" }); // 8x
    const c = (await relatorioDeQualidade(db, storeId)).cruzadas;
    expect(c.skusRepetidos).toHaveLength(1);
    expect(c.skusRepetidos[0]!.valor).toBe("AZ-1");
    expect(c.skusRepetidos[0]!.produtos.map((p) => p.id).sort()).toEqual(["1", "2"]);
    expect(c.nomesRepetidos).toHaveLength(1);
    expect(c.nomesRepetidos[0]!.produtos.map((p) => p.id).sort()).toEqual(["1", "2"]);
    expect(c.promocaoSemDesconto).toEqual([{ id: "3", nome: "Saia" }]);
    expect(c.precosMuitoDiferentes).toEqual([{ id: "4", nome: "Blusa" }]);
    expect(c.prontosNaoPublicados).toEqual([{ id: "2", nome: "vestido  azul" }]);
  });

  it("SKU só se repete de verdade: vazio e únicos não contam", async () => {
    await produto(1, "A");
    await variante(1, { sku: "" });
    await variante(1, { sku: "" });
    await variante(1, { sku: "U-1" });
    expect((await relatorioDeQualidade(db, storeId)).cruzadas.skusRepetidos).toEqual([]);
  });
});
