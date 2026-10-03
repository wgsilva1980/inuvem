import { z } from "zod";
import type { NuvemshopClient } from "./client";
import { categorySchema, type Category, type I18n } from "./types";

export interface CategoryInput {
  name?: I18n;
  description?: I18n;
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
export const updateCategory = async (c: NuvemshopClient, id: number, input: CategoryInput) =>
  categorySchema.parse(await c.put(`/categories/${id}`, input));
export const deleteCategory = (c: NuvemshopClient, id: number) => c.delete(`/categories/${id}`);
