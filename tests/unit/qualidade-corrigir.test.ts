import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import { upsertCategories, upsertProducts, type Db } from "@/lib/sync/repo";
import { camposCorrigiveis, gravarCorrecao, limparTags, sugerirCorrecao, type GeradorTextos } from "@/lib/catalog/corrigir";
import type { GeradorSeo } from "@/lib/seo/generate";
import type { ProductApi } from "@/lib/catalog/update";
import { getProductDetail } from "@/lib/catalog/query";
import type { Product } from "@/lib/nuvemshop/types";

let pg: PGlite;
let db: Db;
let storeId: string;
beforeEach(async () => {
  pg = new PGlite();
  db = { query: async (text, params) => (await pg.query(text, params as never)).rows as never };
  await runMigrations({ exec: async (s) => void (await pg.exec(s)), query: async (s, p) => (await pg.query(s, p)).rows as never }, loadMigrations(join(process.cwd(), "db/migrations")));
  storeId = (await pg.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (1, 'x') RETURNING id")).rows[0]!.id;
  await upsertCategories(db, storeId, [{ id: 10, name: { pt: "Vestidos" } }]);
  await upsertProducts(db, storeId, [produto()]);
});

function produto(over: Partial<Product> = {}): Product {
  return {
    id: 1,
    name: { pt: "Vestido Azul" },
    description: { pt: "<p>Curto</p>" },
    handle: { pt: "vestido-azul" },
    published: true,
    tags: "",
    categories: [{ id: 10, name: { pt: "Vestidos" } }],
    images: [{ id: 10, product_id: 1, src: "https://x/y.jpg" }],
    seo_title: { pt: "" },
    seo_description: { pt: "" },
    variants: [{ id: 100, product_id: 1, sku: "V-1", price: "100.00", stock: 3, stock_management: true, values: [{ pt: "Azul" }, { pt: "M" }] }],
    updated_at: "2026-10-01T10:00:00+0000",
    ...over,
  };
}

const textos: GeradorTextos = async () => ({ descricaoHtml: "<p>Vestido azul de corte reto.</p>", tags: "vestido,azul", avisos: [], entrada: 10, saida: 5 });
const seo: GeradorSeo = async () => ({ titulo: "Vestido Azul | Donatelle Concept", descricao: "Vestido azul para o dia a dia. Confira na Donatelle Concept.", entrada: 7, saida: 3, avisos: [] });
const semFoto = async () => {
  throw new Error("sem rede");
};

describe("quais pendências o botão resolve", () => {
  it("mapeia descrição, SEO e tags e ignora o resto", () => {
    expect(camposCorrigiveis(["foto", "seo_titulo", "seo_descricao", "tags", "descricao", "sku"])).toEqual(["descricao", "seo", "tags"]);
    expect(camposCorrigiveis(["foto", "frete"])).toEqual([]);
  });
  it("limpa tags: minúsculas, sem repetir, sem vírgula dentro, até 8", () => {
    expect(limparTags([" Vestido ", "vestido", "azul, claro", "x".repeat(41), ...Array.from({ length: 12 }, (_, i) => `t${i}`)])).toBe("vestido,t0,t1,t2,t3,t4,t5,t6");
  });
});

describe("sugerirCorrecao", () => {
  it("gera só os campos pedidos, guarda os valores de antes e não altera o produto", async () => {
    const s = await sugerirCorrecao(db, { storeId, produtoId: 1, campos: ["descricao", "seo"], textos, seo, baixar: semFoto });
    expect(s).toMatchObject({ produtoId: "1", descricao: "<p>Vestido azul de corte reto.</p>", seoTitulo: "Vestido Azul | Donatelle Concept", entrada: 17, saida: 8 });
    expect(s.tags).toBeUndefined();
    expect(s.antes).toEqual({ descricao: "<p>Curto</p>", seo_titulo: "", seo_descricao: "", tags: "" });
    expect((await getProductDetail(db, storeId, 1))!.description).toBe("<p>Curto</p>");
  });

  it("produto inexistente e pedido vazio dão erro", async () => {
    await expect(sugerirCorrecao(db, { storeId, produtoId: 99, campos: ["tags"], textos, seo, baixar: semFoto })).rejects.toThrow(/não encontrado/);
    await expect(sugerirCorrecao(db, { storeId, produtoId: 1, campos: [], textos, seo, baixar: semFoto })).rejects.toThrow(/Escolha/);
  });
});

describe("gravarCorrecao", () => {
  const actor = "admin@example.com";
  const antes = { descricao: "<p>Curto</p>", seo_titulo: "", seo_descricao: "", tags: "" };
  const puts: unknown[] = [];
  const api: ProductApi = {
    get: async () => produto(),
    put: async (_id, input) => {
      puts.push(input);
      return produto({
        description: input.description ?? produto().description,
        tags: input.tags ?? "",
        seo_title: input.seo_title ?? produto().seo_title,
        seo_description: input.seo_description ?? produto().seo_description,
      });
    },
  };
  beforeEach(() => void (puts.length = 0));

  it("grava só os campos aprovados, limpa o HTML e registra no histórico", async () => {
    const r = await gravarCorrecao(db, api, { storeId, actor, item: { produtoId: "1", antes, descricao: "<p>Texto novo bom.</p><script>x</script>", tags: "vestido,azul" } });
    expect(r).toEqual({ produtoId: "1", status: "gravado", campos: ["description", "tags"] });
    expect(puts).toEqual([{ description: { pt: "<p>Texto novo bom.</p>" }, tags: "vestido,azul" }]);
    const d = (await getProductDetail(db, storeId, 1))!;
    expect(d).toMatchObject({ description: "<p>Texto novo bom.</p>", tags: "vestido,azul", seo_title: "" });
    const log = (await pg.query("SELECT acao, antes, depois FROM audit_log")).rows as Array<Record<string, unknown>>;
    expect(log).toEqual([{ acao: "produto.atualizar", antes: { description: "<p>Curto</p>", tags: "" }, depois: { description: "<p>Texto novo bom.</p>", tags: "vestido,azul" } }]);
  });

  it("não sobrescreve se o campo mudou depois da sugestão", async () => {
    await upsertProducts(db, storeId, [produto({ description: { pt: "<p>Alguém editou</p>" } })]);
    const r = await gravarCorrecao(db, api, { storeId, actor, item: { produtoId: "1", antes, descricao: "<p>Texto novo bom.</p>" } });
    expect(r).toMatchObject({ status: "mudou", mensagem: expect.stringContaining("a descrição") });
    expect(puts).toHaveLength(0);
  });

  it("recusa SEO acima do limite e produto inexistente", async () => {
    expect(await gravarCorrecao(db, api, { storeId, actor, item: { produtoId: "1", antes, seoTitulo: "x".repeat(71) } })).toMatchObject({ status: "erro" });
    expect(await gravarCorrecao(db, api, { storeId, actor, item: { produtoId: "9", antes, tags: "a" } })).toMatchObject({ status: "erro" });
    expect(puts).toHaveLength(0);
  });

  it("sem mudança real não chama a loja", async () => {
    const r = await gravarCorrecao(db, api, { storeId, actor, item: { produtoId: "1", antes, descricao: "<p>Curto</p>" } });
    expect(r).toEqual({ produtoId: "1", status: "sem_mudanca" });
    expect(puts).toHaveLength(0);
  });

  it("conflito com a Nuvemshop vira 'mudou'", async () => {
    const r = await gravarCorrecao(db, { ...api, get: async () => produto({ name: { pt: "Mudou lá" } }) }, { storeId, actor, item: { produtoId: "1", antes, tags: "a" } });
    expect(r).toMatchObject({ status: "mudou" });
    expect(puts).toHaveLength(0);
  });
});
