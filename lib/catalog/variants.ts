import { z } from "zod";
import { pt, type I18n, type Variant, type VariantInput } from "@/lib/nuvemshop/types";
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

/** Peso em kg: "0,229" e "0.229" -> "0.229" (até 3 casas). Vazio -> null; inválido -> undefined. */
export function parseWeight(raw: string): string | null | undefined {
  const s = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (s === "") return null;
  if (!/^\d{1,6}(\.\d{1,3})?$/.test(s)) return undefined;
  return Number(s).toFixed(3);
}

const weightValue = z.string().transform((value, ctx) => {
  const parsed = parseWeight(value);
  if (parsed === undefined) {
    ctx.addIssue({ code: "custom", message: "Use um peso em kg como 0,229 (até 3 casas decimais)." });
    return z.NEVER;
  }
  return parsed;
});

/** Valor de uma propriedade da variante (ex.: "Azul Claro", "P"). */
const propertyValue = z
  .string()
  .trim()
  .min(1, "Informe o valor.")
  .max(100, "No máximo 100 caracteres.");

const stockValue = z.string().transform((value, ctx) => {
  const s = value.trim();
  if (s === "") return null;
  if (!/^\d{1,9}$/.test(s)) {
    ctx.addIssue({ code: "custom", message: "O estoque deve ser um número inteiro, zero ou maior." });
    return z.NEVER;
  }
  return Number(s);
});

/**
 * Campos editáveis de uma variante. `weight` e `values` são opcionais: ausentes = "não estou editando isso"
 * (medidas ficam de fora). `values` tem um item por propriedade do produto, na ordem das propriedades.
 */
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
    weight: weightValue.optional(),
    values: z.array(propertyValue).optional(),
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
    ...(v.weight !== undefined ? { weight: v.weight } : {}),
    ...(v.values !== undefined ? { values: v.values } : {}),
  }));
export type VariantEdit = z.infer<typeof variantEditSchema>;
export type VariantField = keyof VariantEdit;

const money2 = (value: unknown): string | null => {
  const n = toNumber(value);
  return n === null ? null : n.toFixed(2);
};

const weight3 = (value: unknown): string | null => {
  const n = toNumber(value);
  return n === null ? null : n.toFixed(3);
};

/** Valores da variante (lista de objetos multi-idioma, como vêm da API/espelho) -> textos, um por propriedade. */
export function valuesToStrings(values: unknown): string[] {
  return Array.isArray(values) ? values.map((v) => pt(v as I18n)) : [];
}

/** Linha de `variants` (espelho) ou variante da API -> estado editável, no mesmo formato do formulário. */
export function variantToEdit(v: {
  sku?: string | null;
  price?: unknown;
  promotional_price?: unknown;
  stock_management?: boolean | null;
  stock?: number | null;
  image_id?: number | null;
  weight?: unknown;
  values?: unknown;
}): VariantEdit {
  const management = v.stock_management ?? false;
  return {
    sku: v.sku ? v.sku : null,
    price: money2(v.price) ?? "0.00",
    promotional_price: money2(v.promotional_price),
    stock_management: management,
    stock: management ? (v.stock ?? null) : null,
    image_id: v.image_id ?? null,
    weight: weight3(v.weight),
    values: valuesToStrings(v.values),
  };
}

export const remoteVariantToEdit = (v: Variant): VariantEdit => variantToEdit(v);

const sameWeight = (a: string | null, b: string | null) => (a === null || b === null ? a === b : Number(a) === Number(b));
const sameValues = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

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
  if (after.weight !== undefined && !sameWeight(before.weight ?? null, after.weight)) fields.push("weight");
  if (after.values !== undefined && !sameValues(before.values ?? [], after.values)) fields.push("values");
  return fields;
}

/**
 * Valores novos como objetos multi-idioma. Mantém os outros idiomas que a loja já tenha (só o português é editado aqui);
 * `current` são os objetos de hoje, na mesma ordem.
 */
export function valuesToI18n(values: string[], current: unknown): I18n[] {
  const old = Array.isArray(current) ? (current as I18n[]) : [];
  return values.map((v, i) => ({ ...(old[i] ?? {}), pt: v }));
}

/** Corpo do PUT /products/{id}/variants/{id}: só o que mudou. `currentValues` são os valores atuais (para preservar outros idiomas). */
export function buildVariantInput(after: VariantEdit, fields: VariantField[], currentValues?: unknown): VariantInput {
  const input: VariantInput = {};
  const has = (f: VariantField) => fields.includes(f);
  if (has("sku")) input.sku = after.sku;
  if (has("price")) input.price = after.price;
  if (has("promotional_price")) input.promotional_price = after.promotional_price;
  if (has("stock_management")) input.stock_management = after.stock_management;
  // ao ligar o controle, a quantidade precisa ir junto
  if (has("stock") || (has("stock_management") && after.stock_management)) input.stock = after.stock;
  if (has("image_id")) input.image_id = after.image_id;
  if (has("weight")) input.weight = after.weight ?? null;
  if (has("values") && after.values) input.values = valuesToI18n(after.values, currentValues);
  return input;
}

export function pickVariant(value: VariantEdit, fields: VariantField[]): Partial<VariantEdit> {
  return Object.fromEntries(fields.map((f) => [f, value[f]])) as Partial<VariantEdit>;
}

/** Valores das propriedades vindos de um formulário: campos value_0, value_1… em ordem. Sem nenhum campo, undefined (não edita). */
export function formValues(formData: FormData): string[] | undefined {
  const keys = [...formData.keys()].filter((k) => /^value_\d{1,2}$/.test(k)).sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)));
  return keys.length === 0 ? undefined : keys.map((k) => String(formData.get(k) ?? ""));
}
