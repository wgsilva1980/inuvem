import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import { aplicarRegraCategorias, planejarCategorias, salvarAutoOcultarCategorias, type ApiCategorias } from "@/lib/automations/categorias";
import { ACAO_VISIBILIDADE, definirVisibilidade, devolverAAutomacao, estadoDeVisibilidade, type ApiVisibilidade } from "@/lib/categories/visibilidade";
import { CategoryNotFoundError } from "@/lib/categories/manage";
import { NuvemshopError } from "@/lib/nuvemshop/errors";
import { acaoLabel } from "@/lib/history/labels";
import type { Category, Product } from "@/lib/nuvemshop/types";
import { upsertCategories, upsertProducts, type Db } from "@/lib/sync/repo";

let pg: PGlite;
let db: Db;
let storeId: string;
const actor = "dono@exemplo.com";

beforeEach(async () => {
  pg = new PGlite();
  db = { query: async (text, params) => (await pg.query(text, params as never)).rows as never };
  await runMigrations({ exec: async (s) => void (await pg.exec(s)), query: async (s, p) => (await pg.query(s, p)).rows as never }, loadMigrations(join(process.cwd(), "db/migrations")));
  storeId = ((await pg.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (1, 'x') RETURNING id")).rows[0] as { id: string }).id;
});

const cat = (id: number, nome: string, visibility: "visible" | "hidden" = "visible"): Category => ({ id, name: { pt: nome }, parent: 0, visibility }) as unknown as Category;
const prod = (id: number, categorias: number[]): Product =>
  ({ id, name: { pt: `P${id}` }, published: true, categories: categorias.map((c) => ({ id: c })), variants: [{ id: id * 10, product_id: id, sku: `S${id}`, price: "10" }], updated_at: "2026-10-01T10:00:00+0000" }) as unknown as Product;

function loja(inicial: Category[], opcoes: { recusa?: boolean; ignora?: boolean } = {}) {
  const estado = new Map(inicial.map((c) => [c.id, { ...c } as Record<string, unknown>]));
  const puts: Array<[number, string]> = [];
  const get = async (id: number) => estado.get(id) as unknown as Category;
  const setVisibility = async (id: number, v: "visible" | "hidden") => {
    puts.push([id, v]);
    if (opcoes.recusa) throw new NuvemshopError("422", 422, null, "visibility inválida");
    if (!opcoes.ignora) estado.get(id)!.visibility = v;
    return estado.get(id) as unknown as Category;
  };
  const api: ApiVisibilidade & ApiCategorias = { get, getCategory: get, setVisibility };
  return { api, estado, puts };
}

const marcadas = async () => (await pg.query<{ category_id: string }>("SELECT category_id::text FROM auto_hidden_categories")).rows.map((r) => r.category_id);

describe("ocultar e mostrar à mão", () => {
  it("oculta pela loja, atualiza o espelho, tira da lista da automação e registra no Histórico", async () => {
    await upsertCategories(db, storeId, [cat(1, "Vestidos"), cat(2, "Saias")]);
    await upsertProducts(db, storeId, [prod(1, [1, 2])]);
    const l = loja([cat(1, "Vestidos"), cat(2, "Saias")]);
    expect(await definirVisibilidade(db, l.api, { storeId, actor, id: 2, visibility: "hidden" })).toEqual({ changed: true });
    expect(l.puts).toEqual([[2, "hidden"]]);
    expect((await estadoDeVisibilidade(db, storeId)).get(2)).toEqual({ oculta: true, daAutomacao: false, fixa: false });
    const [log] = (await pg.query<{ acao: string; sucesso: boolean; depois: { nome: string; visibility: string } }>("SELECT acao, sucesso, depois FROM audit_log")).rows;
    expect(log).toMatchObject({ acao: ACAO_VISIBILIDADE, sucesso: true, depois: { nome: "Saias", visibility: "hidden" } });
    expect(acaoLabel(ACAO_VISIBILIDADE)).not.toBe(ACAO_VISIBILIDADE);
  });

  it("mostrar uma categoria vazia que a automação ocultou a deixa fixa: a automação não a oculta de novo, até devolvê-la", async () => {
    await upsertCategories(db, storeId, [cat(1, "Vestidos"), cat(2, "Mais Vendidos")]);
    await upsertProducts(db, storeId, [prod(1, [1])]);
    await salvarAutoOcultarCategorias(db, storeId, true, actor);
    const l = loja([cat(1, "Vestidos"), cat(2, "Mais Vendidos")]);
    await aplicarRegraCategorias(db, l.api, { storeId });
    expect(await marcadas()).toEqual(["2"]);
    expect((await estadoDeVisibilidade(db, storeId)).get(2)).toMatchObject({ oculta: true, daAutomacao: true });

    await definirVisibilidade(db, l.api, { storeId, actor, id: 2, visibility: "visible" });
    expect(await marcadas()).toEqual([]);
    expect((await estadoDeVisibilidade(db, storeId)).get(2)).toEqual({ oculta: false, daAutomacao: false, fixa: true });
    expect((await planejarCategorias(db, storeId)).ocultar).toEqual([]);
    expect(await aplicarRegraCategorias(db, l.api, { storeId, forcar: true })).toMatchObject({ ocultadas: 0 });

    await devolverAAutomacao(db, storeId, 2);
    expect((await planejarCategorias(db, storeId)).ocultar.map((c) => c.nome)).toEqual(["Mais Vendidos"]);
  });

  it("ocultar à mão uma categoria da automação a torna sua: a automação nunca a mostra de volta", async () => {
    await upsertCategories(db, storeId, [cat(1, "Vestidos"), cat(2, "Vazia")]);
    await upsertProducts(db, storeId, [prod(1, [1])]);
    await salvarAutoOcultarCategorias(db, storeId, true, actor);
    const l = loja([cat(1, "Vestidos"), cat(2, "Vazia")]);
    await aplicarRegraCategorias(db, l.api, { storeId });
    await definirVisibilidade(db, l.api, { storeId, actor, id: 2, visibility: "hidden" }); // já estava oculta na loja
    expect(await marcadas()).toEqual([]);
    await upsertProducts(db, storeId, [prod(2, [2])]); // volta um produto publicado
    expect(await aplicarRegraCategorias(db, l.api, { storeId })).toMatchObject({ exibidas: 0 });
  });

  it("se a loja já está assim, só alinha o espelho e guarda a escolha, sem gravar", async () => {
    await upsertCategories(db, storeId, [cat(1, "A")]);
    const l = loja([cat(1, "A", "hidden")]);
    expect(await definirVisibilidade(db, l.api, { storeId, actor, id: 1, visibility: "hidden" })).toEqual({ changed: false });
    expect(l.puts).toEqual([]);
    expect((await estadoDeVisibilidade(db, storeId)).get(1)?.oculta).toBe(true);
  });

  it("recusa categoria desconhecida; loja que recusa ou ignora o campo vira falha registrada, sem mexer no espelho", async () => {
    await upsertCategories(db, storeId, [cat(1, "A")]);
    await expect(definirVisibilidade(db, loja([]).api, { storeId, actor, id: 99, visibility: "hidden" })).rejects.toBeInstanceOf(CategoryNotFoundError);
    await expect(definirVisibilidade(db, loja([cat(1, "A")], { recusa: true }).api, { storeId, actor, id: 1, visibility: "hidden" })).rejects.toBeInstanceOf(NuvemshopError);
    await expect(definirVisibilidade(db, loja([cat(1, "A")], { ignora: true }).api, { storeId, actor, id: 1, visibility: "hidden" })).rejects.toThrow(/não aplicou/);
    expect((await estadoDeVisibilidade(db, storeId)).get(1)).toEqual({ oculta: false, daAutomacao: false, fixa: false });
    expect((await pg.query("SELECT 1 FROM audit_log WHERE NOT sucesso")).rows).toHaveLength(2);
  });
});
