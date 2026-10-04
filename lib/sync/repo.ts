import type { Category, Product } from "@/lib/nuvemshop/types";
import { mapCategory, mapProduct, mapVariant } from "./mappers";

/** Acesso mínimo ao banco, para permitir testar com pglite. */
export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

const json = (v: unknown) => JSON.stringify(v);

export async function upsertProducts(db: Db, storeId: string, products: Product[]): Promise<{ products: number; variants: number }> {
  if (products.length === 0) return { products: 0, variants: 0 };

  const productRows = products.map(mapProduct);
  await db.query(
    `INSERT INTO products (store_id, id, name, description, handle, published, categories, tags, image_count, raw_json, updated_at_remote, synced_at)
     SELECT $1::uuid, r.id, r.name, r.description, r.handle, r.published, r.categories, r.tags, r.image_count, r.raw_json, r.updated_at_remote, now()
     FROM jsonb_to_recordset($2::jsonb) AS r(id bigint, name text, description text, handle text, published boolean,
                                             categories jsonb, tags text, image_count int, raw_json jsonb, updated_at_remote timestamptz)
     ON CONFLICT (store_id, id) DO UPDATE SET
       name = EXCLUDED.name, description = EXCLUDED.description, handle = EXCLUDED.handle,
       published = EXCLUDED.published, categories = EXCLUDED.categories, tags = EXCLUDED.tags,
       image_count = EXCLUDED.image_count, raw_json = EXCLUDED.raw_json,
       updated_at_remote = EXCLUDED.updated_at_remote, synced_at = now()`,
    [storeId, json(productRows)],
  );

  const variantRows = products.flatMap((p) => (p.variants ?? []).map((v) => mapVariant(v, p.id)));
  if (variantRows.length > 0) {
    await db.query(
      `INSERT INTO variants (store_id, id, product_id, sku, price, promotional_price, stock, stock_management,
                             weight, width, height, depth, values, position, raw_json, synced_at)
       SELECT $1::uuid, r.id, r.product_id, r.sku, r.price, r.promotional_price, r.stock, r.stock_management,
              r.weight, r.width, r.height, r.depth, r.values, r.position, r.raw_json, now()
       FROM jsonb_to_recordset($2::jsonb) AS r(id bigint, product_id bigint, sku text, price numeric, promotional_price numeric,
                                               stock int, stock_management boolean, weight numeric, width numeric, height numeric,
                                               depth numeric, values jsonb, position int, raw_json jsonb)
       ON CONFLICT (store_id, id) DO UPDATE SET
         product_id = EXCLUDED.product_id, sku = EXCLUDED.sku, price = EXCLUDED.price,
         promotional_price = EXCLUDED.promotional_price, stock = EXCLUDED.stock,
         stock_management = EXCLUDED.stock_management, weight = EXCLUDED.weight, width = EXCLUDED.width,
         height = EXCLUDED.height, depth = EXCLUDED.depth, values = EXCLUDED.values,
         position = EXCLUDED.position, raw_json = EXCLUDED.raw_json, synced_at = now()`,
      [storeId, json(variantRows)],
    );
  }

  // Variantes removidas na Nuvemshop saem do espelho.
  await db.query(
    `DELETE FROM variants WHERE store_id = $1::uuid AND product_id = ANY($2::bigint[]) AND NOT (id = ANY($3::bigint[]))`,
    [storeId, products.map((p) => p.id), variantRows.map((v) => v.id)],
  );

  return { products: productRows.length, variants: variantRows.length };
}

export async function upsertCategories(db: Db, storeId: string, categories: Category[]): Promise<number> {
  if (categories.length === 0) return 0;
  await db.query(
    `INSERT INTO categories (store_id, id, parent_id, name, handle, raw_json, synced_at)
     SELECT $1::uuid, r.id, r.parent_id, r.name, r.handle, r.raw_json, now()
     FROM jsonb_to_recordset($2::jsonb) AS r(id bigint, parent_id bigint, name text, handle text, raw_json jsonb)
     ON CONFLICT (store_id, id) DO UPDATE SET
       parent_id = EXCLUDED.parent_id, name = EXCLUDED.name, handle = EXCLUDED.handle,
       raw_json = EXCLUDED.raw_json, synced_at = now()`,
    [storeId, json(categories.map(mapCategory))],
  );
  return categories.length;
}

/** Remove do espelho o que não veio mais num sync completo (a Nuvemshop é a fonte da verdade). */
export async function pruneStale(db: Db, storeId: string, before: string): Promise<{ products: number; categories: number }> {
  const p = await db.query<{ id: string }>(
    "DELETE FROM products WHERE store_id = $1::uuid AND synced_at < $2::timestamptz RETURNING id",
    [storeId, before],
  );
  const c = await db.query<{ id: string }>(
    "DELETE FROM categories WHERE store_id = $1::uuid AND synced_at < $2::timestamptz RETURNING id",
    [storeId, before],
  );
  return { products: p.length, categories: c.length };
}
