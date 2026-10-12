import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { createHmac } from "node:crypto";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import { ACAO_EXIBIR, ACAO_OCULTAR, aplicarRegraCategorias, planejarCategorias, salvarAutoOcultarCategorias, ultimasAcoesCategorias, type ApiCategorias } from "@/lib/automations/categorias";
import { NuvemshopError } from "@/lib/nuvemshop/errors";
import { categoriaCompleta } from "@/lib/nuvemshop/categories";
import type { Category, Product } from "@/lib/nuvemshop/types";
import { upsertCategories, upsertProducts, type Db } from "@/lib/sync/repo";
import { handleWebhook, type ResourceApi } from "@/lib/webhooks/handler";
import { acaoLabel } from "@/lib/history/labels";

let pg: PGlite;
let db: Db;
let storeId: string;

beforeEach(async () => {
  pg = new PGlite();
  db = { query: async (text, params) => (await pg.query(text, params as never)).rows as never };
  await runMigrations({ exec: async (s) => void (await pg.exec(s)), query: async (s, p) => (await pg.query(s, p)).rows as never }, loadMigrations(join(process.cwd(), "db/migrations")));
  storeId = ((await pg.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (1, 'x') RETURNING id")).rows[0] as { id: string }).id;
});

const cat = (id: number, nome: string, parent = 0, visibility: "visible" | "hidden" = "visible"): Category => ({ id, name: { pt: nome }, parent, visibility }) as unknown as Category;
const prod = (id: number, categorias: number[], published = true): Product =>
  ({ id, name: { pt: `P${id}` }, published, categories: categorias.map((c) => ({ id: c, name: { pt: `c${c}` } })), variants: [{ id: id * 10, product_id: id, sku: `S${id}`, price: "10" }], updated_at: "2026-10-01T10:00:00+0000" }) as unknown as Product;

/** Loja de mentira: guarda as categorias, aceita o PUT de visibilidade e lembra o que foi chamado. */
function loja(inicial: Category[], opcoes: { recusa?: number[]; ignora?: number[] } = {}) {
  const estado = new Map(inicial.map((c) => [c.id, { ...c } as Record<string, unknown>]));
  const puts: Array<[number, string]> = [];
  const api: ApiCategorias = {
    getCategory: async (id) => estado.get(id) as unknown as Category,
    setVisibility: async (id, v) => {
      puts.push([id, v]);
      if (opcoes.recusa?.includes(id)) throw new NuvemshopError("422", 422, null, "visibility inválida");
      if (!opcoes.ignora?.includes(id)) estado.get(id)!.visibility = v;
      return estado.get(id) as unknown as Category;
    },
  };
  return { api, estado, puts };
}

const marcadas = async () => (await pg.query<{ category_id: string }>("SELECT category_id::text FROM auto_hidden_categories ORDER BY 1")).rows.map((r) => r.category_id);
const visEspelho = async (id: number) => (await pg.query<{ v: string }>("SELECT raw_json->>'visibility' AS v FROM categories WHERE id = $1", [id])).rows[0]!.v;

async function semear(cats: Category[], prods: Product[]) {
  await upsertCategories(db, storeId, cats);
  await upsertProducts(db, storeId, prods);
}

describe("planejarCategorias", () => {
  it("categoria pai com subcategoria que tem produto publicado continua visível; vazia (ou só com rascunho) entra para ocultar", async () => {
    await semear(
      [cat(1, "Roupas"), cat(2, "Vestidos", 1), cat(3, "Saias", 1), cat(4, "Acessórios"), cat(5, "Antigas")],
      [prod(1, [2]), prod(2, [3], false), prod(3, [4], false)],
    );
    const p = await planejarCategorias(db, storeId);
    expect(p.ocultar.map((c) => c.nome)).toEqual(["Acessórios", "Antigas", "Saias"]);
    expect(p.exibir).toEqual([]);
  });

  it("não oculta nada se o espelho não tem nenhum produto publicado (provavelmente incompleto)", async () => {
    await semear([cat(1, "A"), cat(2, "B")], []);
    const p = await planejarCategorias(db, storeId);
    expect(p.espelhoSemProdutos).toBe(true);
    expect(p.ocultar).toEqual([]);
  });

  it("categoria que já estava oculta (por você) não entra para ocultar nem para exibir", async () => {
    await semear([cat(1, "Black Friday", 0, "hidden"), cat(2, "Vestidos")], [prod(1, [2])]);
    const p = await planejarCategorias(db, storeId);
    expect(p.ocultar).toEqual([]);
    expect(p.exibir).toEqual([]);
  });
});

describe("aplicarRegraCategorias", () => {
  it("fica parada com a opção desligada, e a ação manual (forcar) ignora a opção", async () => {
    await semear([cat(1, "Vazia"), cat(2, "Vestidos")], [prod(1, [2])]);
    const l = loja([cat(1, "Vazia"), cat(2, "Vestidos")]);
    expect(await aplicarRegraCategorias(db, l.api, { storeId })).toMatchObject({ desligada: true, ocultadas: 0 });
    expect(l.puts).toEqual([]);
    expect(await aplicarRegraCategorias(db, l.api, { storeId, forcar: true })).toMatchObject({ ocultadas: 1, exibidas: 0 });
    expect(l.puts).toEqual([[1, "hidden"]]);
  });

  it("oculta a vazia, marca como da regra, atualiza o espelho e registra no Histórico", async () => {
    await semear([cat(1, "Vazia"), cat(2, "Vestidos")], [prod(1, [2])]);
    await salvarAutoOcultarCategorias(db, storeId, true, "dono@exemplo.com");
    const l = loja([cat(1, "Vazia"), cat(2, "Vestidos")]);
    const r = await aplicarRegraCategorias(db, l.api, { storeId });
    expect(r).toMatchObject({ ocultadas: 1, exibidas: 0, falhas: [], restantes: 0 });
    expect(await marcadas()).toEqual(["1"]);
    expect(await visEspelho(1)).toBe("hidden");
    const acoes = await ultimasAcoesCategorias(db, storeId);
    expect(acoes).toMatchObject([{ acao: ACAO_OCULTAR, categoria: "Vazia", sucesso: true }]);
    expect(acaoLabel(ACAO_OCULTAR)).not.toBe(ACAO_OCULTAR);
    expect(acaoLabel(ACAO_EXIBIR)).not.toBe(ACAO_EXIBIR);
    // repetir não faz nada
    expect(await aplicarRegraCategorias(db, l.api, { storeId })).toMatchObject({ ocultadas: 0, exibidas: 0 });
    expect(l.puts).toHaveLength(1);
  });

  it("reexibe a que a regra ocultou quando volta um produto publicado, e só essa", async () => {
    await semear([cat(1, "Vazia"), cat(2, "Vestidos"), cat(3, "Black Friday", 0, "hidden")], [prod(1, [2])]);
    await salvarAutoOcultarCategorias(db, storeId, true, "dono@exemplo.com");
    const l = loja([cat(1, "Vazia"), cat(2, "Vestidos"), cat(3, "Black Friday", 0, "hidden")]);
    await aplicarRegraCategorias(db, l.api, { storeId });
    expect(await marcadas()).toEqual(["1"]);
    // chega um produto publicado na categoria 1 e (por engano) em Black Friday também
    await upsertProducts(db, storeId, [prod(2, [1, 3])]);
    const r = await aplicarRegraCategorias(db, l.api, { storeId });
    expect(r).toMatchObject({ ocultadas: 0, exibidas: 1 });
    expect(l.puts).toEqual([[1, "hidden"], [1, "visible"]]); // a Black Friday (ocultada por você) nunca é mexida
    expect(await marcadas()).toEqual([]);
    expect(await visEspelho(1)).toBe("visible");
    expect(await visEspelho(3)).toBe("hidden");
  });

  it("se a pessoa reexibe à mão uma categoria que a regra ocultou, ela sai da lista da regra", async () => {
    await semear([cat(1, "Vazia"), cat(2, "Vestidos")], [prod(1, [2])]);
    await salvarAutoOcultarCategorias(db, storeId, true, "dono@exemplo.com");
    const l = loja([cat(1, "Vazia"), cat(2, "Vestidos")]);
    await aplicarRegraCategorias(db, l.api, { storeId });
    l.estado.get(1)!.visibility = "visible"; // a pessoa mostrou a categoria na loja
    await upsertCategories(db, storeId, [cat(1, "Vazia", 0, "visible")]); // e o webhook atualizou o espelho
    await db.query("UPDATE store_settings SET auto_hide_empty_categories = false WHERE store_id = $1::uuid", [storeId]);
    await aplicarRegraCategorias(db, l.api, { storeId, forcar: true, maxOcultar: 0 }); // limpa as marcas sem ocultar de novo
    expect(await marcadas()).toEqual([]);
  });

  it("confere a loja antes: se já está oculta lá, só alinha o espelho e não grava", async () => {
    await semear([cat(1, "Vazia"), cat(2, "Vestidos")], [prod(1, [2])]);
    const l = loja([cat(1, "Vazia", 0, "hidden"), cat(2, "Vestidos")]); // o espelho está velho
    const r = await aplicarRegraCategorias(db, l.api, { storeId, forcar: true });
    expect(r).toMatchObject({ ocultadas: 0, falhas: [] });
    expect(l.puts).toEqual([]);
    expect(await visEspelho(1)).toBe("hidden");
    expect(await marcadas()).toEqual([]); // não foi a regra: não volta sozinha
  });

  it("falha da loja: registra, não deixa marca e não derruba as outras; a loja que ignora o campo conta como falha", async () => {
    await semear([cat(1, "A"), cat(2, "B"), cat(3, "C"), cat(4, "Vestidos")], [prod(1, [4])]);
    const l = loja([cat(1, "A"), cat(2, "B"), cat(3, "C"), cat(4, "Vestidos")], { recusa: [1], ignora: [2] });
    const r = await aplicarRegraCategorias(db, l.api, { storeId, forcar: true });
    expect(r.ocultadas).toBe(1);
    expect(r.falhas.map((f) => f.categoria)).toEqual(["A", "B"]);
    expect(await marcadas()).toEqual(["3"]);
    const acoes = await ultimasAcoesCategorias(db, storeId);
    expect(acoes.filter((a) => !a.sucesso)).toHaveLength(2);
  });

  it("sem permissão (401/403) para na hora", async () => {
    await semear([cat(1, "A"), cat(2, "B"), cat(3, "Vestidos")], [prod(1, [3])]);
    const l = loja([cat(1, "A"), cat(2, "B"), cat(3, "Vestidos")], { recusa: [] });
    const api: ApiCategorias = { getCategory: l.api.getCategory, setVisibility: async () => { throw new NuvemshopError("403", 403, null, "sem permissão"); } };
    const r = await aplicarRegraCategorias(db, api, { storeId, forcar: true });
    expect(r.falhas).toHaveLength(1);
  });

  it("limita a 5 ocultações por rodada e informa quantas ficaram", async () => {
    const cats = Array.from({ length: 8 }, (_, i) => cat(i + 1, `Vazia ${i + 1}`));
    await semear([...cats, cat(100, "Vestidos")], [prod(1, [100])]);
    const l = loja([...cats, cat(100, "Vestidos")]);
    const r = await aplicarRegraCategorias(db, l.api, { storeId, forcar: true });
    expect(r).toMatchObject({ ocultadas: 5, restantes: 3 });
    expect(await aplicarRegraCategorias(db, l.api, { storeId, forcar: true })).toMatchObject({ ocultadas: 3, restantes: 0 });
  });

  it("automática não tenta de novo, por 6 horas, a categoria que a loja recusou; a manual tenta", async () => {
    await semear([cat(1, "A"), cat(2, "Vestidos")], [prod(1, [2])]);
    await salvarAutoOcultarCategorias(db, storeId, true, "dono@exemplo.com");
    const l = loja([cat(1, "A"), cat(2, "Vestidos")], { recusa: [1] });
    await aplicarRegraCategorias(db, l.api, { storeId });
    await aplicarRegraCategorias(db, l.api, { storeId });
    expect(l.puts).toHaveLength(1);
    await aplicarRegraCategorias(db, l.api, { storeId, forcar: true });
    expect(l.puts).toHaveLength(2);
  });
});

describe("PUT de categoria", () => {
  it("categoriaCompleta preserva a visibilidade e a categoria do Google, para o PUT não reexibir nem apagar", () => {
    const c = { id: 1, name: { pt: "X" }, parent: 0, visibility: "hidden", google_shopping_category: "Black Friday" } as unknown as Category;
    expect(categoriaCompleta(c)).toMatchObject({ visibility: "hidden", google_shopping_category: "Black Friday" });
    expect(categoriaCompleta({ id: 1, name: { pt: "X" }, parent: 0, google_shopping_category: "" } as unknown as Category)).toEqual({ name: { pt: "X" }, parent: null });
  });
});

describe("webhook de produto", () => {
  const SECRET = "segredo";
  it("depois de despublicar o último produto da categoria, oculta a categoria; ao publicar de novo, mostra", async () => {
    await semear([cat(1, "Vestidos"), cat(2, "Outra")], [prod(1, [1]), prod(2, [2])]);
    await salvarAutoOcultarCategorias(db, storeId, true, "dono@exemplo.com");
    const l = loja([cat(1, "Vestidos"), cat(2, "Outra")]);
    let atual = prod(1, [1], false);
    const api: ResourceApi = {
      getProduct: async () => atual,
      getCategory: l.api.getCategory,
      setCategoryVisibility: l.api.setVisibility,
    };
    const enviar = async (event: string) => {
      const raw = JSON.stringify({ store_id: 1, event, id: 1 });
      const sign = createHmac("sha256", SECRET).update(raw).digest("hex");
      let t = Date.now() + Math.random() * 1e9;
      return handleWebhook({ db, clientSecret: SECRET, findStore: async () => ({ id: storeId, nuvemshop_store_id: "1" }), apiFor: async () => api, now: () => t++, log: () => undefined }, raw, sign);
    };
    expect((await enviar("product/updated")).status).toBe(200);
    expect(l.puts).toEqual([[1, "hidden"]]);
    atual = prod(1, [1], true);
    expect((await enviar("product/updated")).status).toBe(200);
    expect(l.puts).toEqual([[1, "hidden"], [1, "visible"]]);
  });

  it("com a opção desligada o webhook não mexe nas categorias", async () => {
    await semear([cat(1, "Vestidos"), cat(2, "Outra")], [prod(1, [1]), prod(2, [2])]);
    const l = loja([cat(1, "Vestidos"), cat(2, "Outra")]);
    const api: ResourceApi = { getProduct: async () => prod(1, [1], false), getCategory: l.api.getCategory, setCategoryVisibility: l.api.setVisibility };
    const raw = JSON.stringify({ store_id: 1, event: "product/updated", id: 1 });
    const r = await handleWebhook({ db, clientSecret: SECRET, findStore: async () => ({ id: storeId, nuvemshop_store_id: "1" }), apiFor: async () => api, log: () => undefined }, raw, createHmac("sha256", SECRET).update(raw).digest("hex"));
    expect(r.status).toBe(200);
    expect(l.puts).toEqual([]);
  });
});
