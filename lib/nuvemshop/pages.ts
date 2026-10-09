import { z } from "zod";
import type { NuvemshopClient } from "./client";
import { i18nSchema, type I18n } from "./types";

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
  seo_title?: I18n;
  seo_description?: I18n;
}

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
export const updateStorePage = async (c: NuvemshopClient, id: number, input: PageInput) => storePageSchema.parse(await c.put(`/pages/${id}`, input));
