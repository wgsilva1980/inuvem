import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import { upsertCategories, upsertProducts, type Db } from "@/lib/sync/repo";
import { getProductDetail } from "@/lib/catalog/query";
import { toEdit } from "@/lib/catalog/edit";
import { updateProduct } from "@/lib/catalog/update";
import { edicaoDaVariante, updateVariant } from "@/lib/catalog/update-variant";
import { updateCategory } from "@/lib/categories/manage";
import { NuvemshopError } from "@/lib/nuvemshop/errors";
import type { Category, Product, Variant } from "@/lib/nuvemshop/types";
import { descreverMudancas, ehDesfazivel, formatarValor, temAntesEDepois } from "@/lib/undo/descrever";
import { DesfazerError, desfazerEvento, listarDesfaziveis, type DesfazerApis } from "@/lib/undo/service";
import { acaoLabel } from "@/lib/history/labels";

describe("descrição das mudanças (pura)", () => {
  it("formata preço, estoque, booleano, vazio, categorias e descrição", () => {
    const nomes = new Map([[10, "Vestidos"], [11, "Saias"]]);
    expect(formatarValor("variante.atualizar", "price", "89.90")).toBe("R$ 89,90");
    expect(formatarValor("variante.atualizar", "promotional_price", null)).toBe("(vazio)");
    expect(formatarValor("variante.atualizar", "stock", 7)).toBe("7");
    expect(formatarValor("variante.atualizar", "stock_management", true)).toBe("Sim");
    expect(formatarValor("produto.atualizar", "published", false)).toBe("Não");
    expect(formatarValor("produto.atualizar", "categories", [10, 11, 99], nomes)).toBe("Vestidos, Saias, #99");
    expect(formatarValor("produto.atualizar", "categories", [], nomes)).toBe("(nenhuma)");
    expect(formatarValor("produto.atualizar", "description", "<p>Olá&nbsp;<strong>mundo</strong></p>")).toBe("Olá mundo");
    expect(formatarValor("produto.atualizar", "description", `<p>${"a".repeat(300)}</p>`)).toHaveLength(120);
    expect(formatarValor("categoria.atualizar", "parent", 10, nomes)).toBe("Vestidos");
    expect(formatarValor("categoria.atualizar", "parent", null, nomes)).toBe("(vazio)");
  });

  it("lista só os campos alterados com 'agora' e 'volta para'", () => {
    expect(descreverMudancas("variante.atualizar", { price: "100.00", stock: 5 }, { price: "90.00", stock: 3 })).toEqual([
      { campo: "Preço", agora: "R$ 90,00", volta: "R$ 100,00" },
      { campo: "Estoque", agora: "3", volta: "5" },
    ]);
  });

  it("só desfaz o que tem antes e depois com os mesmos campos", () => {
    expect(temAntesEDepois({ a: 1 }, { a: 2 })).toBe(true);
    expect(temAntesEDepois(null, { a: 2 })).toBe(false);
    expect(temAntesEDepois({ a: 1 }, { b: 2 })).toBe(false);
    expect(temAntesEDepois({ a: 1 }, {})).toBe(false);
    expect(temAntesEDepois([1], [2])).toBe(false);
    expect(ehDesfazivel("produto.atualizar")).toBe(true);
    expect(ehDesfazivel("produto.apagar")).toBe(false);
    expect(ehDesfazivel("lote.preco")).toBe(false);
    expect(acaoLabel("desfazer.executar")).toMatch(/desfeita/);
  });
});

let pg: PGlite;
let db: Db;
let storeId: string;
const actor = "admin@example.com";

/** Loja falsa e com estado: produtos (com as variações dentro) e categorias. `falhar` faz o próximo put dar erro. */
class Loja {
  produtos = new Map<number, Product>();
  categorias = new Map<number, Category>();
  falhar = false;
  puts: string[] = [];
  api: DesfazerApis = {
    produto: {
      get: async (id) => structuredClone(this.produtos.get(id)!),
      put: async (id, input) => {
        this.puts.push(`produto ${id} ${JSON.stringify(input)}`);
        if (this.falhar) throw new NuvemshopError("422", 422, null, "recusado");
        const novo = { ...this.produtos.get(id)!, ...(input as object) } as Product;
        this.produtos.set(id, novo);
        return structuredClone(novo);
      },
    },
    variante: {
      get: async (pid, vid) => structuredClone(this.produtos.get(pid)!.variants!.find((v) => v.id === vid)!),
      put: async (pid, vid, input) => {
        this.puts.push(`variante ${vid} ${JSON.stringify(input)}`);
        if (this.falhar) throw new NuvemshopError("422", 422, null, "recusado");
        const p = this.produtos.get(pid)!;
        const i = p.variants!.findIndex((v) => v.id === vid);
        p.variants![i] = { ...p.variants![i]!, ...(input as object) } as Variant;
        return structuredClone(p.variants![i]!);
      },
    },
    categoria: {
      get: async (id) => structuredClone(this.categorias.get(id)!),
      create: async () => { throw new Error("não usado"); },
      update: async (id, input) => {
        this.puts.push(`categoria ${id} ${JSON.stringify(input)}`);
        const c = { ...this.categorias.get(id)!, ...(input.name ? { name: input.name } : {}), ...("parent" in input ? { parent: input.parent ?? null } : {}) } as Category;
        this.categorias.set(id, c);
        return structuredClone(c);
      },
      remove: async () => { throw new Error("não usado"); },
    },
  };
}
let loja: Loja;

const variante = (id: number, productId: number): Variant => ({ id, product_id: productId, sku: `SKU-${id}`, price: "100.00", stock_management: true, stock: 10, values: [{ pt: "Azul" }, { pt: "M" }] });
async function semear() {
  loja = new Loja();
  const cats = [{ id: 10, name: { pt: "Vestidos" }, parent: null }, { id: 11, name: { pt: "Saias" }, parent: null }] as unknown as Category[];
  for (const c of cats) loja.categorias.set(c.id, c);
  await upsertCategories(db, storeId, cats);
  const p = { id: 1, name: { pt: "Vestido Midi" }, published: true, categories: [{ id: 10, name: { pt: "Vestidos" } }], images: [], variants: [variante(100, 1)], attributes: [{ pt: "COR" }, { pt: "TAMANHO" }], updated_at: "2026-10-01T10:00:00+0000" } as unknown as Product;
  loja.produtos.set(1, p);
  await upsertProducts(db, storeId, [structuredClone(p)]);
}
const nomeProduto = async () => (await getProductDetail(db, storeId, 1))!.name;
const editarNome = async (nome: string) => updateProduct(db, loja.api.produto, { storeId, actor, productId: 1, after: { ...toEdit((await getProductDetail(db, storeId, 1))!), name: nome } });
const editarVariante = async (campos: Record<string, unknown>) => updateVariant(db, loja.api.variante, { storeId, actor, productId: 1, variantId: 100, after: { ...(await edicaoDaVariante(db, storeId, 1, 100))!, ...campos } as never });
const precoLoja = () => loja.produtos.get(1)!.variants![0]!.price;
const ultimoId = async (acao: string) => (await pg.query<{ id: string }>("SELECT id::text FROM audit_log WHERE acao = $1 ORDER BY id DESC LIMIT 1", [acao])).rows[0]!.id;

beforeEach(async () => {
  pg = new PGlite();
  db = { query: async (text, params) => (await pg.query(text, params as never)).rows as never };
  await runMigrations({ exec: async (s) => void (await pg.exec(s)), query: async (s, p) => (await pg.query(s, p)).rows as never }, loadMigrations(join(process.cwd(), "db/migrations")));
  storeId = (await pg.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (1, 'x') RETURNING id")).rows[0]!.id;
  await semear();
});

describe("central de desfazer", () => {
  it("lista produto, variação e categoria alterados, da mais nova à mais antiga, com o que volta; ignora falhas e outros tipos", async () => {
    await editarNome("Vestido Midi Azul");
    await editarVariante({ price: "89.90", stock: 7 });
    await updateCategory(db, loja.api.categoria, { storeId, actor, id: 11, edit: { name: "Saias Midi", parent: null } });
    await pg.query("INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, antes, depois, sucesso) VALUES ($1, $2, 'produto.atualizar', 'produto', '1', '{\"name\":\"x\"}', '{\"name\":\"y\"}', false)", [storeId, actor]); // falhou
    await pg.query("INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, antes, depois, sucesso) VALUES ($1, $2, 'produto.apagar', 'produto', '1', '{\"a\":1}', '{\"a\":2}', true)", [storeId, actor]); // não desfaz
    const itens = await listarDesfaziveis(db, storeId);
    expect(itens.map((i) => i.acao)).toEqual(["categoria.atualizar", "variante.atualizar", "produto.atualizar"]);
    expect(itens[0]).toMatchObject({ nome: "Saias Midi", estado: "ok", mudancas: [{ campo: "Nome", agora: "Saias Midi", volta: "Saias" }] });
    expect(itens[1]).toMatchObject({ nome: "Vestido Midi Azul — Azul / M", link: "/produtos/1", estado: "ok" });
    expect(itens[1]!.mudancas).toEqual(expect.arrayContaining([{ campo: "Preço", agora: "R$ 89,90", volta: "R$ 100,00" }, { campo: "Estoque", agora: "7", volta: "10" }]));
    expect(itens[2]!.mudancas).toEqual([{ campo: "Nome", agora: "Vestido Midi Azul", volta: "Vestido Midi" }]);
  });

  it("desfaz o nome do produto: volta na loja e no espelho, entra no Histórico e não desfaz duas vezes; desfazer o desfazer refaz", async () => {
    await editarNome("Vestido Midi Azul");
    const id = await ultimoId("produto.atualizar");
    expect(await desfazerEvento(db, loja.api, { storeId, actor, id })).toEqual({ acao: "produto.atualizar", nome: "Vestido Midi" });
    expect(loja.produtos.get(1)!.name).toEqual({ pt: "Vestido Midi" });
    expect(await nomeProduto()).toBe("Vestido Midi");
    const acoes = (await pg.query<{ acao: string }>("SELECT acao FROM audit_log ORDER BY id")).rows.map((r) => r.acao);
    expect(acoes).toEqual(["produto.atualizar", "produto.atualizar", "desfazer.executar"]);
    await expect(desfazerEvento(db, loja.api, { storeId, actor, id })).rejects.toThrow(/já foi desfeita/);
    // o original sai da lista; a reversão aparece e pode ser desfeita (refazer)
    const lista = await listarDesfaziveis(db, storeId);
    expect(lista.map((i) => i.id)).not.toContain(id);
    await desfazerEvento(db, loja.api, { storeId, actor, id: lista[0]!.id });
    expect(await nomeProduto()).toBe("Vestido Midi Azul");
  });

  it("variação: só desfaz se o valor ainda é o que a alteração deixou; desfazer a mais nova libera a mais antiga", async () => {
    await editarVariante({ price: "90.00" });
    const a = await ultimoId("variante.atualizar");
    await editarVariante({ price: "80.00" });
    const b = await ultimoId("variante.atualizar");
    const lista = await listarDesfaziveis(db, storeId);
    expect(lista.map((i) => [i.id, i.estado])).toEqual([[b, "ok"], [a, "mudou"]]);
    await expect(desfazerEvento(db, loja.api, { storeId, actor, id: a })).rejects.toThrow(/já foi alterado depois/);
    expect((await pg.query("SELECT count(*)::int AS n FROM undo_marks")).rows[0]).toEqual({ n: 0 }); // recusar não reserva
    expect(precoLoja()).toBe("80.00");
    await desfazerEvento(db, loja.api, { storeId, actor, id: b });
    expect(precoLoja()).toBe("90.00");
    await desfazerEvento(db, loja.api, { storeId, actor, id: a });
    expect(precoLoja()).toBe("100.00");
    expect((await edicaoDaVariante(db, storeId, 1, 100))!.price).toBe("100.00");
  });

  it("variação: estoque volta ao valor de antes e só ele vai à loja", async () => {
    await editarVariante({ stock: 3 });
    await desfazerEvento(db, loja.api, { storeId, actor, id: await ultimoId("variante.atualizar") });
    expect(loja.puts.at(-1)).toBe('variante 100 {"stock":10}');
    expect(loja.produtos.get(1)!.variants![0]!.stock).toBe(10);
  });

  it("categoria: devolve nome e pai", async () => {
    await updateCategory(db, loja.api.categoria, { storeId, actor, id: 11, edit: { name: "Saias Midi", parent: 10 } });
    await desfazerEvento(db, loja.api, { storeId, actor, id: await ultimoId("categoria.atualizar") });
    expect(loja.categorias.get(11)).toMatchObject({ name: { pt: "Saias" }, parent: null });
    expect((await pg.query<{ name: string; parent_id: string | null }>("SELECT name, parent_id::text FROM categories WHERE id = 11")).rows[0]).toEqual({ name: "Saias", parent_id: null });
  });

  it("se a loja recusar, a reserva é desfeita e dá para tentar de novo", async () => {
    await editarNome("Vestido Midi Azul");
    const id = await ultimoId("produto.atualizar");
    loja.falhar = true;
    await expect(desfazerEvento(db, loja.api, { storeId, actor, id })).rejects.toBeInstanceOf(NuvemshopError);
    expect((await pg.query("SELECT count(*)::int AS n FROM undo_marks")).rows[0]).toEqual({ n: 0 });
    expect(await nomeProduto()).toBe("Vestido Midi Azul");
    loja.falhar = false;
    await desfazerEvento(db, loja.api, { storeId, actor, id });
    expect(await nomeProduto()).toBe("Vestido Midi");
  });

  it("duas chamadas ao mesmo tempo desfazem uma vez só", async () => {
    await editarNome("Vestido Midi Azul");
    const id = await ultimoId("produto.atualizar");
    const r = await Promise.allSettled([desfazerEvento(db, loja.api, { storeId, actor, id }), desfazerEvento(db, loja.api, { storeId, actor, id })]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(loja.puts.filter((p) => p.startsWith("produto")).length).toBe(2); // a edição original + uma reversão
  });

  it("recusa registro inexistente, de outro tipo, falho, sem antes, antigo ou de item que sumiu", async () => {
    await expect(desfazerEvento(db, loja.api, { storeId, actor, id: "99999" })).rejects.toThrow(/não encontrado/);
    const ins = async (acao: string, antes: unknown, depois: unknown, sucesso = true, dias = 0) =>
      (await pg.query<{ id: string }>("INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, antes, depois, sucesso, created_at) VALUES ($1, $2, $3, 'produto', '1', $4::jsonb, $5::jsonb, $6, now() - make_interval(days => $7::int)) RETURNING id::text", [storeId, actor, acao, JSON.stringify(antes), JSON.stringify(depois), sucesso, dias])).rows[0]!.id;
    for (const id of [await ins("produto.apagar", { name: "a" }, { name: "b" }), await ins("produto.atualizar", { name: "a" }, { name: "b" }, false), await ins("produto.atualizar", null, { name: "b" })]) {
      await expect(desfazerEvento(db, loja.api, { storeId, actor, id })).rejects.toBeInstanceOf(DesfazerError);
    }
    await expect(desfazerEvento(db, loja.api, { storeId, actor, id: await ins("produto.atualizar", { name: "a" }, { name: "b" }, true, 91) })).rejects.toThrow(/últimos 90 dias/);
    await pg.query("DELETE FROM products WHERE id = 1");
    await expect(desfazerEvento(db, loja.api, { storeId, actor, id: await ins("produto.atualizar", { name: "a" }, { name: "b" }) })).rejects.toThrow(/não existe mais/);
  });
});
