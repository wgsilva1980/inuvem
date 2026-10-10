import { z } from "zod";
import type { NuvemshopClient } from "./client";
import { categorySchema, pt, type Category, type I18n } from "./types";

export interface CategoryInput {
  name?: I18n;
  description?: I18n;
  seo_title?: I18n;
  seo_description?: I18n;
  handle?: I18n;
  parent?: number | null;
}

export async function listAllCategories(c: NuvemshopClient): Promise<Category[]> {
  const all: Category[] = [];
  for await (const page of c.paginate<unknown>("/categories")) all.push(...z.array(categorySchema).parse(page.items));
  return all;
}
export const getCategory = async (c: NuvemshopClient, id: number) => categorySchema.parse(await c.get(`/categories/${id}`));
export const createCategory = async (c: NuvemshopClient, input: CategoryInput) =>
  categorySchema.parse(await c.post("/categories", input));
/** Todos os campos editáveis de uma categoria como a loja os tem hoje (a raiz tem `parent: 0`, que vira `null` ao enviar). */
export function categoriaCompleta(c: Category): CategoryInput {
  const o = c as Record<string, unknown>;
  const i18n = (v: unknown) => (v && typeof v === "object" ? (v as I18n) : undefined);
  return {
    name: c.name,
    ...(c.description ? { description: c.description } : {}),
    ...(c.handle ? { handle: c.handle } : {}),
    ...(i18n(o.seo_title) ? { seo_title: i18n(o.seo_title) } : {}),
    ...(i18n(o.seo_description) ? { seo_description: i18n(o.seo_description) } : {}),
    parent: c.parent ? c.parent : null,
  };
}

/**
 * A loja recusa (422) um campo de texto enviado vazio (ex.: `description: {pt: ""}`), mas aceita o campo ausente, que fica vazio do mesmo jeito.
 * Por isso os campos de texto sem nenhum conteúdo são tirados do envio.
 */
export function semTextosVazios<T extends object>(input: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    const textoVazio = v !== null && typeof v === "object" && !Array.isArray(v) && Object.values(v as Record<string, unknown>).every((x) => x === null || x === "");
    if (!textoVazio) out[k] = v;
  }
  return out as T;
}

export class CategoriaAlteradaError extends Error {}

/**
 * Atualiza a categoria SEM perder o que não foi pedido. A API da Nuvemshop trata o PUT como substituição: enviar só alguns campos apaga os outros
 * (nome, endereço, descrição e categoria pai). Por isso lê a categoria, junta o que mudou aos campos atuais e envia tudo. Depois confere o que a
 * loja devolveu e, se algo que não era para mudar mudou, restaura o que havia antes e avisa.
 */
export async function updateCategory(c: NuvemshopClient, id: number, changes: CategoryInput): Promise<Category> {
  const antes = await getCategory(c, id);
  const base = categoriaCompleta(antes);
  const depois = categorySchema.parse(await c.put(`/categories/${id}`, semTextosVazios({ ...base, ...changes })));
  const perdeu: string[] = [];
  if (changes.name === undefined && pt(depois.name) !== pt(antes.name)) perdeu.push("nome");
  if (changes.handle === undefined && pt(depois.handle) !== pt(antes.handle)) perdeu.push("endereço (handle)");
  if (changes.description === undefined && pt(depois.description) !== pt(antes.description)) perdeu.push("descrição");
  if (changes.parent === undefined && (depois.parent ?? 0) !== (antes.parent ?? 0)) perdeu.push("categoria pai");
  if (perdeu.length > 0) {
    await c.put(`/categories/${id}`, semTextosVazios(base));
    throw new CategoriaAlteradaError(`A loja alterou ${perdeu.join(", ")} da categoria ao salvar; o que havia antes foi restaurado. Nada foi gravado.`);
  }
  return depois;
}
export const deleteCategory = (c: NuvemshopClient, id: number) => c.delete(`/categories/${id}`);
