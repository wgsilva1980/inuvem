import { z } from "zod";
import type { ProductInput } from "@/lib/nuvemshop/types";
import type { ProductDetail } from "./query";

/** Campos editáveis do produto na Fase 2 (variantes, preço, estoque e imagens ficam nas fases seguintes). */
export const productEditSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome do produto.").max(255, "No máximo 255 caracteres."),
  description: z.string().max(100_000, "Descrição longa demais."),
  tags: z
    .string()
    .trim()
    .max(1000, "No máximo 1000 caracteres.")
    // normaliza "a , b,,c" -> "a,b,c"
    .transform((s) =>
      s
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .join(","),
    ),
  published: z.boolean(),
  seo_title: z.string().trim().max(70, "O título SEO deve ter no máximo 70 caracteres."),
  seo_description: z.string().trim().max(320, "A descrição SEO deve ter no máximo 320 caracteres."),
  categories: z.array(z.number().int().positive()),
});
export type ProductEdit = z.infer<typeof productEditSchema>;

export type EditableField = keyof ProductEdit;

/** Valores atuais do espelho, no mesmo formato do formulário. */
export function toEdit(detail: ProductDetail): ProductEdit {
  return {
    name: detail.name,
    description: detail.description ?? "",
    tags: detail.tags ?? "",
    published: detail.published,
    seo_title: detail.seo_title,
    seo_description: detail.seo_description,
    categories: detail.categories.map((c) => c.id).sort((a, b) => a - b),
  };
}

const sameCategories = (a: number[], b: number[]) => {
  const x = [...a].sort((p, q) => p - q);
  const y = [...b].sort((p, q) => p - q);
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

/** Campos que mudaram entre o estado atual e o enviado (só eles vão para a API e para o histórico). */
export function changedFields(before: ProductEdit, after: ProductEdit): EditableField[] {
  const fields: EditableField[] = [];
  for (const key of ["name", "description", "tags", "published", "seo_title", "seo_description"] as const) {
    if (before[key] !== after[key]) fields.push(key);
  }
  if (!sameCategories(before.categories, after.categories)) fields.push("categories");
  return fields;
}

/** Monta o corpo do PUT /products/{id} só com o que mudou (campos multi-idioma no idioma "pt"). */
export function buildProductInput(after: ProductEdit, fields: EditableField[]): ProductInput {
  const input: ProductInput = {};
  for (const f of fields) {
    switch (f) {
      case "name":
        input.name = { pt: after.name };
        break;
      case "description":
        input.description = { pt: after.description };
        break;
      case "seo_title":
        input.seo_title = { pt: after.seo_title };
        break;
      case "seo_description":
        input.seo_description = { pt: after.seo_description };
        break;
      case "tags":
        input.tags = after.tags;
        break;
      case "published":
        input.published = after.published;
        break;
      case "categories":
        input.categories = after.categories;
        break;
    }
  }
  return input;
}

export function pick<T extends ProductEdit>(value: T, fields: EditableField[]): Partial<ProductEdit> {
  return Object.fromEntries(fields.map((f) => [f, value[f]])) as Partial<ProductEdit>;
}
