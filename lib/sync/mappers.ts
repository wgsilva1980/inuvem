import { pt, type Category, type Product, type Variant } from "@/lib/nuvemshop/types";

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toTimestamp(value: string | undefined): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export interface ProductRow {
  id: number;
  name: string;
  description: string | null;
  handle: string | null;
  published: boolean;
  categories: Array<{ id: number; name: string }>;
  tags: string | null;
  image_count: number;
  raw_json: Product;
  updated_at_remote: string | null;
}

export function mapProduct(p: Product): ProductRow {
  return {
    id: p.id,
    name: pt(p.name) || `Produto ${p.id}`,
    description: pt(p.description) || null,
    handle: pt(p.handle) || null,
    published: p.published ?? false,
    categories: (p.categories ?? []).map((c) => ({ id: c.id, name: pt(c.name) })),
    tags: p.tags ?? null,
    image_count: p.images?.length ?? 0,
    raw_json: p,
    updated_at_remote: toTimestamp(p.updated_at),
  };
}

export interface VariantRow {
  id: number;
  product_id: number;
  sku: string | null;
  price: number | null;
  promotional_price: number | null;
  stock: number | null;
  stock_management: boolean;
  weight: number | null;
  width: number | null;
  height: number | null;
  depth: number | null;
  values: Array<Record<string, string | null>>;
  position: number | null;
  raw_json: Variant;
}

export function mapVariant(v: Variant, productId: number): VariantRow {
  return {
    id: v.id,
    product_id: v.product_id ?? productId,
    sku: v.sku ?? null,
    price: toNumber(v.price),
    promotional_price: toNumber(v.promotional_price),
    stock: v.stock ?? null,
    stock_management: v.stock_management ?? false,
    weight: toNumber(v.weight),
    width: toNumber(v.width),
    height: toNumber(v.height),
    depth: toNumber(v.depth),
    values: v.values ?? [],
    position: v.position ?? null,
    raw_json: v,
  };
}

export interface CategoryRow {
  id: number;
  parent_id: number | null;
  name: string;
  handle: string | null;
  raw_json: Category;
}

export function mapCategory(c: Category): CategoryRow {
  return {
    id: c.id,
    parent_id: c.parent ?? null,
    name: pt(c.name) || `Categoria ${c.id}`,
    handle: pt(c.handle) || null,
    raw_json: c,
  };
}
