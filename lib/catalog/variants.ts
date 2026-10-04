import { z } from "zod";
import type { Variant, VariantInput } from "@/lib/nuvemshop/types";
import { toNumber } from "@/lib/sync/mappers";

/** "1.234,56", "99,90" e "99.90" -> "1234.56" / "99.90" (sempre 2 casas). Vazio -> null; inválido -> undefined. */
export function parseMoney(raw: string): string | null | undefined {
  const s = raw.trim().replace(/\s/g, "").replace(/^R\$/i, "");
  if (s === "") return null;
  const normalized = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(normalized)) return undefined;
  return Number(normalized).toFixed(2);
}

const money = (required: boolean, requiredMessage: string) =>
  z.string().transform((value, ctx) => {
    const parsed = parseMoney(value);
    if (parsed === undefined) {
      ctx.addIssue({ code: "custom", message: "Use um valor como 99,90 (até 2 casas decimais)." });
      return z.NEVER;
    }
    if (parsed === null && required) {
      ctx.addIssue({ code: "custom", message: requiredMessage });
      return z.NEVER;
    }
    if (parsed !== null && required && Number(parsed) <= 0) {
      ctx.addIssue({ code: "custom", message: "O preço deve ser maior que zero." });
      return z.NEVER;
    }
    return parsed;
  });

const imageId = z.string().transform((value, ctx) => {
  const s = value.trim();
  if (s === "") return null;
  if (!/^\d{1,15}$/.test(s)) {
    ctx.addIssue({ code: "custom", message: "Imagem inválida." });
    return z.NEVER;
  }
  return Number(s);
});

const stockValue = z.string().transform((value, ctx) => {
  const s = value.trim();
  if (s === "") return null;
  if (!/^\d{1,9}$/.test(s)) {
    ctx.addIssue({ code: "custom", message: "O estoque deve ser um número inteiro, zero ou maior." });
    return z.NEVER;
  }
  return Number(s);
});

/** Campos editáveis de uma variante na Fase 3 (peso e medidas ficam para depois). */
export const variantEditSchema = z
  .object({
    sku: z
      .string()
      .trim()
      .max(255, "No máximo 255 caracteres.")
      .transform((v) => (v === "" ? null : v)),
    price: money(true, "Informe o preço."),
    promotional_price: money(false, ""),
    stock_management: z.boolean(),
    stock: stockValue,
    image_id: imageId,
  })
  .superRefine((v, ctx) => {
    if (v.price !== null && v.promotional_price !== null && Number(v.promotional_price) >= Number(v.price)) {
      ctx.addIssue({ code: "custom", path: ["promotional_price"], message: "O preço promocional deve ser menor que o preço." });
    }
    if (v.stock_management && v.stock === null) {
      ctx.addIssue({ code: "custom", path: ["stock"], message: "Informe o estoque ou desligue o controle de estoque." });
    }
  })
  .transform((v) => ({
    sku: v.sku,
    price: v.price as string,
    promotional_price: v.promotional_price,
    stock_management: v.stock_management,
    // sem controle de estoque, a quantidade não vale (a API usa null = ilimitado)
    stock: v.stock_management ? v.stock : null,
    image_id: v.image_id,
  }));
export type VariantEdit = z.infer<typeof variantEditSchema>;
export type VariantField = keyof VariantEdit;

const money2 = (value: unknown): string | null => {
  const n = toNumber(value);
  return n === null ? null : n.toFixed(2);
};

/** Linha de `variants` (espelho) ou variante da API -> estado editável, no mesmo formato do formulário. */
export function variantToEdit(v: {
  sku?: string | null;
  price?: unknown;
  promotional_price?: unknown;
  stock_management?: boolean | null;
  stock?: number | null;
  image_id?: number | null;
}): VariantEdit {
  const management = v.stock_management ?? false;
  return {
    sku: v.sku ? v.sku : null,
    price: money2(v.price) ?? "0.00",
    promotional_price: money2(v.promotional_price),
    stock_management: management,
    stock: management ? (v.stock ?? null) : null,
    image_id: v.image_id ?? null,
  };
}

export const remoteVariantToEdit = (v: Variant): VariantEdit => variantToEdit(v);

export function changedVariantFields(before: VariantEdit, after: VariantEdit): VariantField[] {
  const fields: VariantField[] = [];
  if (before.sku !== after.sku) fields.push("sku");
  if (Number(before.price) !== Number(after.price)) fields.push("price");
  if ((before.promotional_price === null) !== (after.promotional_price === null) || Number(before.promotional_price) !== Number(after.promotional_price)) {
    fields.push("promotional_price");
  }
  if (before.stock_management !== after.stock_management) fields.push("stock_management");
  if (before.stock !== after.stock) fields.push("stock");
  if (before.image_id !== after.image_id) fields.push("image_id");
  return fields;
}

/** Corpo do PUT /products/{id}/variants/{id}: só o que mudou. */
export function buildVariantInput(after: VariantEdit, fields: VariantField[]): VariantInput {
  const input: VariantInput = {};
  const has = (f: VariantField) => fields.includes(f);
  if (has("sku")) input.sku = after.sku;
  if (has("price")) input.price = after.price;
  if (has("promotional_price")) input.promotional_price = after.promotional_price;
  if (has("stock_management")) input.stock_management = after.stock_management;
  // ao ligar o controle, a quantidade precisa ir junto
  if (has("stock") || (has("stock_management") && after.stock_management)) input.stock = after.stock;
  if (has("image_id")) input.image_id = after.image_id;
  return input;
}

export function pickVariant(value: VariantEdit, fields: VariantField[]): Partial<VariantEdit> {
  return Object.fromEntries(fields.map((f) => [f, value[f]])) as Partial<VariantEdit>;
}
