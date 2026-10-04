import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import { upsertCategories, upsertProducts, type Db } from "@/lib/sync/repo";
import { descendantIds, flattenTree, pathName } from "@/lib/categories/tree";
import {
  CategoryConflictError,
  CategoryNotFoundError,
  CategoryRuleError,
  categoryEditSchema,
  createCategory,
  deleteCategory,
  productCountsByCategory,
  updateCategory,
  type CategoryApi,
} from "@/lib/categories/manage";
import { NuvemshopError } from "@/lib/nuvemshop/errors";
import type { Category, Product } from "@/lib/nuvemshop/types";

describe("árvore de categorias", () => {
  const rows = [
    { id: 1, parent_id: null, name: "Roupas" },
    { id: 2, parent_id: 1, name: "Vestidos" },
    { id: 3, parent_id: 2, name: "Longos" },
    { id: 4, parent_id: 1, name: "Blusas" },
    { id: 5, parent_id: null, name: "Acessórios" },
    { id: 6, parent_id: 99, name: "Órfã" }, // pai inexistente: vira raiz
  ];

  it("achata em ordem de exibição, com profundidade", () => {
    expect(flattenTree(rows).map((r) => `${"-".repeat(r.depth)}${r.name}`)).toEqual(["Acessórios", "Órfã", "Roupas", "-Blusas", "-Vestidos", "--Longos"]);
  });

  it("descendentes e caminho", () => {
    expect([...descendantIds(rows, 1)].sort()).toEqual([2, 3, 4]);
    expect([...descendantIds(rows, 3)]).toEqual([]);
    expect(pathName(rows, 3)).toBe("Roupas > Vestidos > Longos");
    expect(pathName(rows, 77)).toBe("#77");
  });

  it("não trava com ciclo nem com auto-referência", () => {
    const bad = [
      { id: 1, parent_id: 2, name: "A" },
      { id: 2, parent_id: 1, name: "B" },
      { id: 3, parent_id: 3, name: "C" },
    ];
    expect(flattenTree(bad).map((r) => r.id)).toEqual([3]); // o ciclo A<->B fica inalcançável, mas não gera laço infinito
    expect(descendantIds(bad, 1).size).toBeLessThanOrEqual(2);
    expect(pathName(bad, 1)).toBe("B > A");
  });
});

describe("categoryEditSchema", () => {
  it("valida e normaliza", () => {
    expect(categoryEditSchema.parse({ name: "  Vestidos ", parent: "" })).toEqual({ name: "Vestidos", parent: null });
    expect(categoryEditSchema.parse({ name: "X", parent: "12" })).toEqual({ name: "X", parent: 12 });
    expect(categoryEditSchema.safeParse({ name: "  ", parent: "" }).success).toBe(false);
    expect(categoryEditSchema.safeParse({ name: "x".repeat(101), parent: "" }).success).toBe(false);
    expect(categoryEditSchema.safeParse({ name: "X", parent: "abc" }).success).toBe(false);
  });
});

let pg: PGlite;
let db: Db;
let storeId: string;
const actor = "admin@example.com";

class FakeCategories implements CategoryApi {
  cats = new Map<number, Category>();
  calls: string[] = [];
  nextId = 100;
  failUpdate = false;
  failRemove: number | null = null;
  constructor(list: Category[]) {
    for (const c of list) this.cats.set(c.id, structuredClone(c));
  }
  async get(id: number) {
    this.calls.push(`GET ${id}`);
    const c = this.cats.get(id);
    if (!c) throw new NuvemshopError("404", 404, null);
    return structuredClone(c);
  }
  async create(input: { name: { pt: string }; parent?: number }) {
    this.calls.push(`POST ${JSON.stringify(input)}`);
    const c = { id: this.nextId++, name: input.name, parent: input.parent ?? null } as Category;
    this.cats.set(c.id, c);
    return structuredClone(c);
  }
  async update(id: number, input: { name?: { pt: string }; parent?: number | null }) {
    this.calls.push(`PUT ${id} ${JSON.stringify(input)}`);
    if (this.failUpdate) throw new NuvemshopError("422", 422, null, "recusado");
    const c = this.cats.get(id)!;
    if (input.name) c.name = input.name;
    if (input.parent !== undefined) c.parent = input.parent;
    return structuredClone(c);
  }
  async remove(id: number) {
    this.calls.push(`DELETE ${id}`);
    if (this.failRemove === id) throw new NuvemshopError("500", 500, null);
    if (!this.cats.has(id)) throw new NuvemshopError("404", 404, null);
    this.cats.delete(id);
  }
}

const cat = (id: number, name: string, parent: number | null = null): Category => ({ id, name: { pt: name }, parent }) as Category;
const audits = async () => (await pg.query("SELECT acao, entidade, entidade_id, sucesso, antes, depois FROM audit_log ORDER BY id")).rows as Array<Record<string, unknown>>;
const mirror = async () => (await pg.query<{ id: string; name: string; parent_id: string | null }>("SELECT id::text, name, parent_id::text FROM categories ORDER BY id")).rows;

beforeEach(async () => {
  pg = new PGlite();
  db = { query: async (text, params) => (await pg.query(text, params as never)).rows as never };
  await runMigrations(
    { exec: async (s) => void (await pg.exec(s)), query: async (s, p) => (await pg.query(s, p)).rows as never },
    loadMigrations(join(process.cwd(), "db/migrations")),
  );
  storeId = (await pg.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (1, 'x') RETURNING id")).rows[0]!.id;
});

async function setup(list: Category[]) {
  await upsertCategories(db, storeId, list);
  return new FakeCategories(list);
}
const edit = (name: string, parent: number | null = null) => ({ name, parent });

describe("criar categoria", () => {
  it("cria na loja, grava no espelho e registra", async () => {
    const api = await setup([cat(1, "Roupas")]);
    const id = await createCategory(db, api, { storeId, actor, edit: edit("Vestidos", 1) });
    expect(api.calls).toEqual(['POST {"name":{"pt":"Vestidos"},"parent":1}']);
    expect(await mirror()).toEqual([
      { id: "1", name: "Roupas", parent_id: null },
      { id: String(id), name: "Vestidos", parent_id: "1" },
    ]);
    expect(await audits()).toMatchObject([{ acao: "categoria.criar", entidade: "categoria", entidade_id: String(id), sucesso: true, depois: { name: "Vestidos", parent: 1 } }]);
  });

  it("raiz não envia parent; recusa pai inexistente e nome repetido no mesmo nível (sem chamar a API)", async () => {
    const api = await setup([cat(1, "Roupas")]);
    await createCategory(db, api, { storeId, actor, edit: edit("Sapatos") });
    expect(api.calls).toEqual(['POST {"name":{"pt":"Sapatos"}}']);
    api.calls.length = 0;
    await expect(createCategory(db, api, { storeId, actor, edit: edit("X", 999) })).rejects.toThrow(/pai não existe/);
    await expect(createCategory(db, api, { storeId, actor, edit: edit(" roupas ") })).rejects.toThrow(/Já existe uma categoria/);
    expect(api.calls).toEqual([]);
    // mesmo nome em outro nível é permitido
    await createCategory(db, api, { storeId, actor, edit: edit("Roupas", 1) });
  });

  it("registra a falha da API", async () => {
    const api = await setup([]);
    api.create = async () => {
      throw new NuvemshopError("422", 422, null, "nome inválido");
    };
    await expect(createCategory(db, api, { storeId, actor, edit: edit("X") })).rejects.toBeInstanceOf(NuvemshopError);
    expect(await audits()).toMatchObject([{ acao: "categoria.criar", sucesso: false }]);
    expect(await mirror()).toEqual([]);
  });
});

describe("editar categoria", () => {
  const tree = () => [cat(1, "Roupas"), cat(2, "Vestidos", 1), cat(3, "Longos", 2), cat(4, "Sapatos")];

  it("renomeia e move, enviando só o que mudou", async () => {
    const api = await setup(tree());
    expect(await updateCategory(db, api, { storeId, actor, id: 2, edit: edit("Vestidos de festa", 1) })).toEqual({ changed: true, fields: ["name"] });
    expect(api.calls).toEqual(["GET 2", 'PUT 2 {"name":{"pt":"Vestidos de festa"}}']);
    expect(await updateCategory(db, api, { storeId, actor, id: 2, edit: edit("Vestidos de festa", 4) })).toEqual({ changed: true, fields: ["parent"] });
    expect(api.calls.at(-1)).toBe('PUT 2 {"parent":4}');
    expect((await mirror()).find((r) => r.id === "2")).toMatchObject({ name: "Vestidos de festa", parent_id: "4" });
    expect((await audits())[0]).toMatchObject({ acao: "categoria.atualizar", antes: { name: "Vestidos" }, depois: { name: "Vestidos de festa" } });
  });

  it("mover para a raiz envia parent null", async () => {
    const api = await setup(tree());
    await updateCategory(db, api, { storeId, actor, id: 2, edit: edit("Vestidos", null) });
    expect(api.calls.at(-1)).toBe('PUT 2 {"parent":null}');
  });

  it("sem mudança não chama a API", async () => {
    const api = await setup(tree());
    expect(await updateCategory(db, api, { storeId, actor, id: 2, edit: edit("Vestidos", 1) })).toEqual({ changed: false });
    expect(api.calls).toEqual([]);
  });

  it("impede ciclos: filha de si mesma ou de uma descendente", async () => {
    const api = await setup(tree());
    await expect(updateCategory(db, api, { storeId, actor, id: 1, edit: edit("Roupas", 1) })).rejects.toThrow(/filha de si mesma/);
    await expect(updateCategory(db, api, { storeId, actor, id: 1, edit: edit("Roupas", 3) })).rejects.toThrow(/subcategorias/);
    expect(api.calls).toEqual([]);
  });

  it("recusa nome repetido no destino e categoria inexistente", async () => {
    const api = await setup([...tree(), cat(5, "Longos", 1)]);
    await expect(updateCategory(db, api, { storeId, actor, id: 3, edit: edit("Longos", 1) })).rejects.toThrow(/Já existe uma categoria/);
    await expect(updateCategory(db, api, { storeId, actor, id: 999, edit: edit("X") })).rejects.toBeInstanceOf(CategoryNotFoundError);
  });

  it("conflito: se a loja mudou a categoria, atualiza o espelho e não envia", async () => {
    const api = await setup(tree());
    api.cats.get(2)!.name = { pt: "Mudou na loja" };
    await expect(updateCategory(db, api, { storeId, actor, id: 2, edit: edit("Meu nome", 1) })).rejects.toBeInstanceOf(CategoryConflictError);
    expect(api.calls).toEqual(["GET 2"]);
    expect((await mirror()).find((r) => r.id === "2")!.name).toBe("Mudou na loja");
  });

  it("falha da API: registra e mantém o espelho", async () => {
    const api = await setup(tree());
    api.failUpdate = true;
    await expect(updateCategory(db, api, { storeId, actor, id: 2, edit: edit("Novo", 1) })).rejects.toBeInstanceOf(NuvemshopError);
    expect((await mirror()).find((r) => r.id === "2")!.name).toBe("Vestidos");
    expect(await audits()).toMatchObject([{ sucesso: false }]);
  });
});

describe("apagar categoria", () => {
  const product = (id: number, cats: number[]): Product => ({
    id,
    name: { pt: `P${id}` },
    published: true,
    categories: cats.map((c) => ({ id: c, name: { pt: `C${c}` } })),
    variants: [],
  });

  it("apaga na loja e no espelho, tira dos produtos e registra quantos eram", async () => {
    const api = await setup([cat(1, "Roupas"), cat(2, "Promo")]);
    await upsertProducts(db, storeId, [product(1, [1, 2]), product(2, [2]), product(3, [1])]);
    expect(await productCountsByCategory(db, storeId)).toEqual(new Map([[1, 2], [2, 2]]));
    expect(await deleteCategory(db, api, { storeId, actor, id: 2 })).toEqual({ produtos: 2 });
    expect(api.calls).toEqual(["DELETE 2"]);
    expect((await mirror()).map((r) => r.id)).toEqual(["1"]);
    const cats = (await pg.query<{ id: string; categories: Array<{ id: number }> }>("SELECT id::text, categories FROM products ORDER BY id")).rows;
    expect(cats.map((c) => c.categories.map((x) => x.id))).toEqual([[1], [], [1]]);
    expect(await audits()).toMatchObject([{ acao: "categoria.apagar", sucesso: true, antes: { name: "Promo", produtos: 2 } }]);
  });

  it("recusa categoria com subcategorias", async () => {
    const api = await setup([cat(1, "Roupas"), cat(2, "Vestidos", 1)]);
    await expect(deleteCategory(db, api, { storeId, actor, id: 1 })).rejects.toThrow(/1 subcategoria\. Mova ou apague essa antes/);
    expect(api.calls).toEqual([]);
    expect((await mirror()).map((r) => r.id)).toEqual(["1", "2"]);
  });

  it("se já não existe na loja (404), só limpa o espelho", async () => {
    const api = await setup([cat(1, "Roupas")]);
    api.cats.delete(1);
    await deleteCategory(db, api, { storeId, actor, id: 1 });
    expect(await mirror()).toEqual([]);
  });

  it("falha da API: não mexe no espelho e registra", async () => {
    const api = await setup([cat(1, "Roupas")]);
    api.failRemove = 1;
    await expect(deleteCategory(db, api, { storeId, actor, id: 1 })).rejects.toBeInstanceOf(NuvemshopError);
    expect((await mirror()).map((r) => r.id)).toEqual(["1"]);
    expect(await audits()).toMatchObject([{ acao: "categoria.apagar", sucesso: false }]);
  });

  it("categoria inexistente", async () => {
    const api = await setup([]);
    await expect(deleteCategory(db, api, { storeId, actor, id: 5 })).rejects.toBeInstanceOf(CategoryRuleError);
  });
});
