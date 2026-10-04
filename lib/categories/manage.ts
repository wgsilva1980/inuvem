import { z } from "zod";
import { NuvemshopError } from "@/lib/nuvemshop/errors";
import { pt, type Category } from "@/lib/nuvemshop/types";
import { removeCategoryFromMirror, upsertCategories, type Db } from "@/lib/sync/repo";
import { descendantIds, type CategoryNode } from "./tree";

/** Acesso à API da Nuvemshop (injetado para testar sem rede). */
export interface CategoryApi {
  get(id: number): Promise<Category>;
  create(input: { name: { pt: string }; parent?: number }): Promise<Category>;
  update(id: number, input: { name?: { pt: string }; parent?: number | null }): Promise<Category>;
  remove(id: number): Promise<void>;
}

export const categoryEditSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome da categoria.").max(100, "No máximo 100 caracteres."),
  parent: z.string().transform((v, ctx) => {
    const s = v.trim();
    if (s === "") return null;
    if (!/^\d{1,15}$/.test(s)) {
      ctx.addIssue({ code: "custom", message: "Categoria pai inválida." });
      return z.NEVER;
    }
    return Number(s);
  }),
});
export type CategoryEdit = z.infer<typeof categoryEditSchema>;

/** Erros de regra (mensagem já em português, própria para mostrar ao usuário). */
export class CategoryRuleError extends Error {}
export class CategoryNotFoundError extends CategoryRuleError {
  constructor() {
    super("Categoria não encontrada no espelho. Sincronize o catálogo e tente de novo.");
  }
}
export class CategoryConflictError extends CategoryRuleError {
  constructor() {
    super("Esta categoria foi alterada na Nuvemshop depois que você abriu a página. Os dados foram atualizados: revise e tente de novo.");
  }
}

interface Row extends CategoryNode {
  handle: string | null;
}

async function loadAll(db: Db, storeId: string): Promise<Row[]> {
  const rows = await db.query<{ id: string; parent_id: string | null; name: string; handle: string | null }>(
    "SELECT id::text AS id, parent_id::text AS parent_id, name, handle FROM categories WHERE store_id = $1::uuid",
    [storeId],
  );
  return rows.map((r) => ({ id: Number(r.id), parent_id: r.parent_id === null ? null : Number(r.parent_id), name: r.name, handle: r.handle }));
}

const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase("pt-BR") === b.trim().toLocaleLowerCase("pt-BR");

async function audit(
  db: Db,
  e: { storeId: string; actor: string; acao: "criar" | "atualizar" | "apagar"; id: number | string; antes?: unknown; depois?: unknown; resultado: unknown; sucesso: boolean },
) {
  await db.query(
    `INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, antes, depois, resultado_api, sucesso)
     VALUES ($1::uuid, $2, $3, 'categoria', $4, $5::jsonb, $6::jsonb, $7::jsonb, $8)`,
    [e.storeId, e.actor, `categoria.${e.acao}`, String(e.id), e.antes === undefined ? null : JSON.stringify(e.antes), e.depois === undefined ? null : JSON.stringify(e.depois), JSON.stringify(e.resultado), e.sucesso],
  );
}

const failure = (err: unknown) =>
  err instanceof NuvemshopError ? { status: err.status, mensagem: err.apiMessage ?? err.message } : { mensagem: err instanceof Error ? err.message : String(err) };

function checkName(all: Row[], name: string, parent: number | null, exceptId?: number) {
  if (all.some((r) => r.id !== exceptId && r.parent_id === parent && sameName(r.name, name))) {
    throw new CategoryRuleError("Já existe uma categoria com esse nome neste nível.");
  }
}

export async function createCategory(db: Db, api: CategoryApi, args: { storeId: string; actor: string; edit: CategoryEdit }): Promise<number> {
  const { storeId, actor, edit } = args;
  const all = await loadAll(db, storeId);
  if (edit.parent !== null && !all.some((r) => r.id === edit.parent)) throw new CategoryRuleError("A categoria pai não existe. Sincronize e tente de novo.");
  checkName(all, edit.name, edit.parent);

  const depois = { name: edit.name, parent: edit.parent };
  try {
    const created = await api.create({ name: { pt: edit.name }, ...(edit.parent !== null ? { parent: edit.parent } : {}) });
    await upsertCategories(db, storeId, [created]);
    await audit(db, { storeId, actor, acao: "criar", id: created.id, depois, resultado: { status: "ok" }, sucesso: true });
    return created.id;
  } catch (err) {
    await audit(db, { storeId, actor, acao: "criar", id: "novo", depois, resultado: failure(err), sucesso: false });
    throw err;
  }
}

export type CategoryUpdateResult = { changed: false } | { changed: true; fields: string[] };

export async function updateCategory(db: Db, api: CategoryApi, args: { storeId: string; actor: string; id: number; edit: CategoryEdit }): Promise<CategoryUpdateResult> {
  const { storeId, actor, id, edit } = args;
  const all = await loadAll(db, storeId);
  const current = all.find((r) => r.id === id);
  if (!current) throw new CategoryNotFoundError();

  const fields: Array<"name" | "parent"> = [];
  if (current.name !== edit.name) fields.push("name");
  if (current.parent_id !== edit.parent) fields.push("parent");
  if (fields.length === 0) return { changed: false };

  if (edit.parent !== null) {
    if (edit.parent === id) throw new CategoryRuleError("Uma categoria não pode ser filha de si mesma.");
    if (!all.some((r) => r.id === edit.parent)) throw new CategoryRuleError("A categoria pai não existe. Sincronize e tente de novo.");
    if (descendantIds(all, id).has(edit.parent)) throw new CategoryRuleError("Não dá para mover uma categoria para dentro de uma das suas subcategorias.");
  }
  checkName(all, edit.name, edit.parent, id);

  // Alteração por fora: compara o conteúdo (nome e pai) da loja com o espelho.
  const remote = await api.get(id);
  if (pt(remote.name) !== current.name || (remote.parent ?? null) !== current.parent_id) {
    await upsertCategories(db, storeId, [remote]);
    throw new CategoryConflictError();
  }

  const input: { name?: { pt: string }; parent?: number | null } = {};
  if (fields.includes("name")) input.name = { pt: edit.name };
  if (fields.includes("parent")) input.parent = edit.parent;
  const antes = { name: current.name, parent: current.parent_id };
  const depois = { name: edit.name, parent: edit.parent };
  try {
    const updated = await api.update(id, input);
    await upsertCategories(db, storeId, [updated]);
    await audit(db, { storeId, actor, acao: "atualizar", id, antes, depois, resultado: { status: "ok" }, sucesso: true });
    return { changed: true, fields };
  } catch (err) {
    await audit(db, { storeId, actor, acao: "atualizar", id, antes, depois, resultado: failure(err), sucesso: false });
    throw err;
  }
}

/** Apaga a categoria na loja e no espelho. Recusa se tiver subcategorias (o usuário move ou apaga as filhas antes). */
export async function deleteCategory(db: Db, api: CategoryApi, args: { storeId: string; actor: string; id: number }): Promise<{ produtos: number }> {
  const { storeId, actor, id } = args;
  const all = await loadAll(db, storeId);
  const current = all.find((r) => r.id === id);
  if (!current) throw new CategoryNotFoundError();
  const children = all.filter((r) => r.parent_id === id).length;
  if (children > 0) throw new CategoryRuleError(`Esta categoria tem ${children} ${children === 1 ? "subcategoria" : "subcategorias"}. Mova ou apague ${children === 1 ? "essa" : "essas"} antes.`);

  const count = await db.query<{ n: string }>("SELECT count(*)::text AS n FROM products WHERE store_id = $1::uuid AND categories @> $2::jsonb", [storeId, JSON.stringify([{ id }])]);
  const produtos = Number(count[0]?.n ?? 0);
  const antes = { name: current.name, parent: current.parent_id, produtos };
  try {
    try {
      await api.remove(id);
    } catch (err) {
      if (!(err instanceof NuvemshopError && err.status === 404)) throw err; // já não existia na loja: só limpa o espelho
    }
    await removeCategoryFromMirror(db, storeId, id);
    await audit(db, { storeId, actor, acao: "apagar", id, antes, resultado: { status: "ok" }, sucesso: true });
    return { produtos };
  } catch (err) {
    await audit(db, { storeId, actor, acao: "apagar", id, antes, resultado: failure(err), sucesso: false });
    throw err;
  }
}

/** Contagem de produtos por categoria (para a árvore). */
export async function productCountsByCategory(db: Db, storeId: string): Promise<Map<number, number>> {
  const rows = await db.query<{ id: string; n: string }>(
    `SELECT (c->>'id') AS id, count(*)::text AS n FROM products p, jsonb_array_elements(p.categories) c WHERE p.store_id = $1::uuid GROUP BY 1`,
    [storeId],
  );
  return new Map(rows.map((r) => [Number(r.id), Number(r.n)]));
}

export { loadAll as loadCategories };
