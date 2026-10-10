import { z } from "zod";
import type { NuvemshopClient } from "./client";
import { semTextosVazios } from "./categories";
import { i18nSchema, pt, type I18n } from "./types";

/** Página institucional da loja (Sobre nós, Trocas…). Só o que o painel usa; o resto passa direto. */
export const storePageSchema = z
  .object({
    id: z.number(),
    title: i18nSchema.nullish(),
    content: i18nSchema.nullish(),
    handle: i18nSchema.nullish(),
    publish: z.boolean().nullish(),
    seo_title: i18nSchema.nullish(),
    seo_description: i18nSchema.nullish(),
    updated_at: z.string().nullish(),
  })
  .passthrough();
export type StorePage = z.infer<typeof storePageSchema>;

export interface PageInput {
  title?: I18n;
  content?: I18n;
  handle?: I18n;
  publish?: boolean;
  seo_title?: I18n;
  seo_description?: I18n;
}

export class PaginaAlteradaError extends Error {}

export async function listAllPages(c: NuvemshopClient): Promise<StorePage[]> {
  const all: StorePage[] = [];
  for await (const page of c.paginate<unknown>("/pages")) {
    for (const raw of page.items) {
      const r = storePageSchema.safeParse(raw);
      if (r.success) all.push(r.data);
    }
  }
  return all;
}
export const getStorePage = async (c: NuvemshopClient, id: number) => storePageSchema.parse(await c.get(`/pages/${id}`));
/** Todos os campos editáveis de uma página como a loja os tem hoje. */
export function paginaCompleta(p: StorePage): PageInput {
  return {
    ...(p.title ? { title: p.title } : {}),
    ...(p.content ? { content: p.content } : {}),
    ...(p.handle ? { handle: p.handle } : {}),
    ...(typeof p.publish === "boolean" ? { publish: p.publish } : {}),
    ...(p.seo_title ? { seo_title: p.seo_title } : {}),
    ...(p.seo_description ? { seo_description: p.seo_description } : {}),
  };
}

/**
 * Atualiza a página SEM perder o que não foi pedido (o PUT da Nuvemshop substitui: campos omitidos podem ser apagados). Lê a página, junta o que mudou
 * aos campos atuais e envia tudo; depois confere e, se título, conteúdo ou endereço mudaram sem querer, restaura o que havia e avisa.
 */
export async function updateStorePage(c: NuvemshopClient, id: number, changes: PageInput): Promise<StorePage> {
  const antes = await getStorePage(c, id);
  const base = paginaCompleta(antes);
  const depois = storePageSchema.parse(await c.put(`/pages/${id}`, semTextosVazios({ ...base, ...changes })));
  const perdeu: string[] = [];
  if (changes.title === undefined && pt(depois.title) !== pt(antes.title)) perdeu.push("título");
  if (changes.content === undefined && pt(depois.content) !== pt(antes.content)) perdeu.push("conteúdo");
  if (changes.handle === undefined && pt(depois.handle) !== pt(antes.handle)) perdeu.push("endereço (handle)");
  if (perdeu.length > 0) {
    await c.put(`/pages/${id}`, semTextosVazios(base));
    throw new PaginaAlteradaError(`A loja alterou ${perdeu.join(", ")} da página ao salvar; o que havia antes foi restaurado. Nada foi gravado.`);
  }
  return depois;
}
