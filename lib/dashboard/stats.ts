import type { Db } from "@/lib/sync/repo";

export interface CatalogStats {
  produtos: number;
  publicados: number;
  naoPublicados: number;
  variantes: number;
  categorias: number;
  semImagem: number;
  semCategoria: number;
  semSku: number;
  semEstoque: number;
  semDescricao: number;
}

/** Indicadores do catálogo, calculados do espelho. Cada "sem..." corresponde a um filtro da lista de produtos. */
export async function getCatalogStats(db: Db, storeId: string): Promise<CatalogStats> {
  const rows = await db.query<Record<keyof CatalogStats, string>>(
    `SELECT
       count(*)::text AS produtos,
       (count(*) FILTER (WHERE p.published))::text AS publicados,
       (count(*) FILTER (WHERE NOT p.published))::text AS "naoPublicados",
       (SELECT count(*) FROM variants v WHERE v.store_id = $1::uuid)::text AS variantes,
       (SELECT count(*) FROM categories c WHERE c.store_id = $1::uuid)::text AS categorias,
       (count(*) FILTER (WHERE p.image_count = 0))::text AS "semImagem",
       (count(*) FILTER (WHERE jsonb_array_length(p.categories) = 0))::text AS "semCategoria",
       (count(*) FILTER (WHERE EXISTS (SELECT 1 FROM variants v WHERE v.store_id = p.store_id AND v.product_id = p.id AND (v.sku IS NULL OR v.sku = ''))))::text AS "semSku",
       (count(*) FILTER (WHERE EXISTS (SELECT 1 FROM variants v WHERE v.store_id = p.store_id AND v.product_id = p.id AND v.stock_management AND coalesce(v.stock, 0) <= 0)))::text AS "semEstoque",
       (count(*) FILTER (WHERE p.description IS NULL OR btrim(p.description) = ''))::text AS "semDescricao"
     FROM products p WHERE p.store_id = $1::uuid`,
    [storeId],
  );
  const r = rows[0]!;
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v)])) as unknown as CatalogStats;
}
