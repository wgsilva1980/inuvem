import { z } from "zod";

/** Campos multi-idioma: { "pt": "..." }. */
export const i18nSchema = z.record(z.string(), z.string().nullable());
export type I18n = z.infer<typeof i18nSchema>;

/** Preços chegam como string ("19.90") ou número, dependendo do endpoint. */
const decimal = z.union([z.string(), z.number()]).nullable();

export const variantSchema = z
  .object({
    id: z.number(),
    product_id: z.number(),
    sku: z.string().nullable().optional(),
    price: decimal.optional(),
    promotional_price: decimal.optional(),
    stock_management: z.boolean().optional(),
    stock: z.number().nullable().optional(),
    weight: decimal.optional(),
    width: decimal.optional(),
    height: decimal.optional(),
    depth: decimal.optional(),
    values: z.array(i18nSchema).optional(),
    position: z.number().nullable().optional(),
    /** Imagem escolhida para a variação (uma das imagens do produto). */
    image_id: z.number().nullable().optional(),
  })
  .passthrough();
export type Variant = z.infer<typeof variantSchema>;

export const imageSchema = z
  .object({
    id: z.number(),
    product_id: z.number(),
    src: z.string(),
    position: z.number().nullable().optional(),
    // A API devolve `alt` como objeto multi-idioma ({ "pt": "..." }, ou {} quando vazio) na loja real,
    // embora a documentação o mostre como lista: aceitamos as duas formas.
    alt: z.union([z.array(z.string()), i18nSchema]).nullable().optional(),
  })
  .passthrough();
export type ProductImage = z.infer<typeof imageSchema>;

export const categoryRefSchema = z.object({ id: z.number(), name: i18nSchema.optional() }).passthrough();

export const productSchema = z
  .object({
    id: z.number(),
    name: i18nSchema,
    description: i18nSchema.nullable().optional(),
    handle: i18nSchema.nullable().optional(),
    published: z.boolean().optional(),
    tags: z.string().nullable().optional(),
    categories: z.array(categoryRefSchema).optional(),
    variants: z.array(variantSchema).optional(),
    images: z.array(imageSchema).optional(),
    seo_title: i18nSchema.nullable().optional(),
    seo_description: i18nSchema.nullable().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  })
  .passthrough();
export type Product = z.infer<typeof productSchema>;

export const categorySchema = z
  .object({
    id: z.number(),
    name: i18nSchema,
    handle: i18nSchema.nullable().optional(),
    parent: z.number().nullable().optional(),
    subcategories: z.array(z.number()).optional(),
    description: i18nSchema.nullable().optional(),
  })
  .passthrough();
export type Category = z.infer<typeof categorySchema>;

export const locationSchema = z.object({ id: z.string(), name: i18nSchema.optional() }).passthrough();
export type Location = z.infer<typeof locationSchema>;

export const webhookSchema = z
  .object({ id: z.number(), url: z.string(), event: z.string() })
  .passthrough();
export type Webhook = z.infer<typeof webhookSchema>;

/** Payload de escrita de produto (parcial; a Nuvemshop aceita só o que for enviado). */
export type ProductInput = Partial<{
  name: I18n;
  description: I18n;
  handle: I18n;
  published: boolean;
  tags: string;
  categories: number[];
  seo_title: I18n;
  seo_description: I18n;
  variants: VariantInput[];
  images: Array<{ src: string; position?: number }>;
}>;

export type VariantInput = Partial<{
  sku: string | null;
  price: string | number;
  promotional_price: string | number | null;
  stock_management: boolean;
  stock: number | null;
  weight: string | number;
  width: string | number;
  height: string | number;
  depth: string | number;
  values: I18n[];
  image_id: number | null;
}>;

/**
 * Item de PATCH /products/stock-price.
 * ATENÇÃO (a confirmar na documentação oficial): nome exato dos campos de estoque
 * (`stock` x `inventory_levels`) e limite de itens por chamada.
 */
export interface StockPriceItem {
  id: number;
  variants: Array<{
    id: number;
    price?: string | number;
    promotional_price?: string | number | null;
    stock?: number;
    inventory_levels?: Array<{ location_id: string; stock: number }>;
  }>;
}

/** Converte um campo multi-idioma em texto (pt, senão o primeiro idioma disponível). */
export function pt(value: I18n | null | undefined): string {
  if (!value) return "";
  return value.pt ?? Object.values(value).find((v): v is string => typeof v === "string" && v !== "") ?? "";
}
