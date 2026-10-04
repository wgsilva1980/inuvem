import type { Db } from "@/lib/sync/repo";

export const PAGE_SIZE = 25;

export type StatusFilter = "todos" | "publicados" | "rascunhos";
export type SortKey = "nome" | "atualizados";

export interface CatalogFilters {
  q?: string;
  status?: StatusFilter;
  categoryId?: number;
  semSku?: boolean;
  semImagem?: boolean;
  semCategoria?: boolean;
  /** Variante com controle de estoque e quantidade zerada (ou sem quantidade). */
  semEstoque?: boolean;
  semDescricao?: boolean;
  sort?: SortKey;
  page?: number;
}

export interface CatalogItem {
  id: string;
  name: string;
  published: boolean;
  image_count: number;
  /** Primeira imagem do produto (menor position), para a miniatura da lista. */
  thumb_url: string | null;
  categories: Array<{ id: number; name: string }>;
  variant_count: number;
  price_min: string | null;
  price_max: string | null;
  stock_total: string | null;
  updated_at_remote: string | null;
}

export interface CatalogPage {
  items: CatalogItem[];
  total: number;
  page: number;
  pages: number;
}

/** Escapa curingas do LIKE para a busca ser literal. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Monta o WHERE (e os parâmetros) dos filtros do catálogo. Compartilhado com a seleção de produtos para operações em massa. */
export function buildCatalogWhere(storeId: string, filters: CatalogFilters): { whereSql: string; params: unknown[] } {
  const where: string[] = ["p.store_id = $1::uuid"];
  const params: unknown[] = [storeId];
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  const q = filters.q?.trim();
  if (q) {
    const like = add(`%${escapeLike(q)}%`);
    where.push(
      `(p.name ILIKE ${like} OR EXISTS (SELECT 1 FROM variants v WHERE v.store_id = p.store_id AND v.product_id = p.id AND v.sku ILIKE ${like}))`,
    );
  }
  if (filters.status === "publicados") where.push("p.published = true");
  if (filters.status === "rascunhos") where.push("p.published = false");
  if (filters.categoryId !== undefined) {
    where.push(`p.categories @> ${add(JSON.stringify([{ id: filters.categoryId }]))}::jsonb`);
  }
  if (filters.semSku) {
    where.push(
      "EXISTS (SELECT 1 FROM variants v WHERE v.store_id = p.store_id AND v.product_id = p.id AND (v.sku IS NULL OR v.sku = ''))",
    );
  }

  if (filters.semImagem) where.push("p.image_count = 0");
  if (filters.semCategoria) where.push("jsonb_array_length(p.categories) = 0");
  if (filters.semDescricao) where.push("(p.description IS NULL OR btrim(p.description) = '')");
  if (filters.semEstoque) {
    where.push(
      "EXISTS (SELECT 1 FROM variants v WHERE v.store_id = p.store_id AND v.product_id = p.id AND v.stock_management AND coalesce(v.stock, 0) <= 0)",
    );
  }

  return { whereSql: where.join(" AND "), params };
}

export async function listCatalog(db: Db, storeId: string, filters: CatalogFilters = {}): Promise<CatalogPage> {
  const { whereSql, params } = buildCatalogWhere(storeId, filters);
  const totalRow = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM products p WHERE ${whereSql}`, params);
  const total = Number(totalRow[0]?.n ?? 0);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, filters.page ?? 1), pages);

  const order = filters.sort === "atualizados" ? "p.updated_at_remote DESC NULLS LAST, p.id DESC" : "lower(p.name), p.id";
  const items = await db.query<CatalogItem>(
    `SELECT p.id::text AS id, p.name, p.published, p.image_count, p.categories, p.updated_at_remote,
            (SELECT i->>'src' FROM jsonb_array_elements(coalesce(p.raw_json->'images', '[]'::jsonb)) i
              ORDER BY CASE WHEN (i->>'position') ~ '^[0-9]+$' THEN (i->>'position')::int END NULLS LAST LIMIT 1) AS thumb_url,
            agg.variant_count, agg.price_min, agg.price_max, agg.stock_total
     FROM products p
     LEFT JOIN LATERAL (
       SELECT count(*)::int AS variant_count, min(v.price)::text AS price_min, max(v.price)::text AS price_max,
              sum(v.stock) FILTER (WHERE v.stock_management)::text AS stock_total
       FROM variants v WHERE v.store_id = p.store_id AND v.product_id = p.id
     ) agg ON true
     WHERE ${whereSql}
     ORDER BY ${order}
     LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
    params,
  );
  return { items, total, page, pages };
}

export interface CategoryOption {
  id: number;
  name: string;
  parent_id: number | null;
}

export async function listCategoryOptions(db: Db, storeId: string): Promise<CategoryOption[]> {
  return db.query<CategoryOption>(
    "SELECT id::int AS id, name, parent_id::int AS parent_id FROM categories WHERE store_id = $1::uuid ORDER BY lower(name)",
    [storeId],
  );
}

export interface ProductDetail {
  id: string;
  name: string;
  description: string | null;
  tags: string | null;
  published: boolean;
  categories: Array<{ id: number; name: string }>;
  seo_title: string;
  seo_description: string;
  updated_at_remote: string | null;
  variants: Array<{ id: string; sku: string | null; price: string | null; promotional_price: string | null; stock: number | null; stock_management: boolean; values: Array<Record<string, string | null>>; image_id: string | null }>;
}

export async function getProductDetail(db: Db, storeId: string, id: number): Promise<ProductDetail | null> {
  const rows = await db.query<Omit<ProductDetail, "variants">>(
    `SELECT id::text AS id, name, description, tags, published, categories, updated_at_remote,
            coalesce(raw_json->'seo_title'->>'pt', '') AS seo_title,
            coalesce(raw_json->'seo_description'->>'pt', '') AS seo_description
     FROM products WHERE store_id = $1::uuid AND id = $2::bigint`,
    [storeId, id],
  );
  const product = rows[0];
  if (!product) return null;
  const variants = await db.query<ProductDetail["variants"][number]>(
    `SELECT id::text AS id, sku, price::text AS price, promotional_price::text AS promotional_price, stock, stock_management, values, nullif(raw_json->>'image_id', '') AS image_id
     FROM variants WHERE store_id = $1::uuid AND product_id = $2::bigint ORDER BY position NULLS LAST, id`,
    [storeId, id],
  );
  return { ...product, variants };
}

/** IDs dos produtos que casam com os filtros (para operações em massa). Pede um a mais que o limite para saber se estourou. */
export async function listProductIds(db: Db, storeId: string, filters: CatalogFilters, limit: number): Promise<{ ids: number[]; truncated: boolean }> {
  const { whereSql, params } = buildCatalogWhere(storeId, { ...filters, page: undefined });
  const rows = await db.query<{ id: string }>(`SELECT p.id::text AS id FROM products p WHERE ${whereSql} ORDER BY lower(p.name), p.id LIMIT ${limit + 1}`, params);
  return { ids: rows.slice(0, limit).map((r) => Number(r.id)), truncated: rows.length > limit };
}
