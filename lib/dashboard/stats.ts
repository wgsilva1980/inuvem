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

export interface OpcoesStats {
  /** Só conta os produtos publicados (e as variantes e categorias deles). `publicados` e `naoPublicados` continuam sendo os totais da loja. */
  soPublicados?: boolean;
}

/**
 * Indicadores do catálogo, calculados do espelho. Cada "sem..." corresponde a um filtro da lista de produtos. Com `soPublicados`, produtos, variantes,
 * categorias (as que têm ao menos um produto publicado) e cada "sem..." só olham os publicados; `publicados` e `naoPublicados` seguem sendo os totais.
 */
export async function getCatalogStats(db: Db, storeId: string, opcoes: OpcoesStats = {}): Promise<CatalogStats> {
  const escopo = "(NOT $2::boolean OR p.published)";
  const rows = await db.query<Record<keyof CatalogStats, string>>(
    `SELECT
       (count(*) FILTER (WHERE ${escopo}))::text AS produtos,
       (count(*) FILTER (WHERE p.published))::text AS publicados,
       (count(*) FILTER (WHERE NOT p.published))::text AS "naoPublicados",
       (SELECT count(*) FROM variants v JOIN products pv ON pv.store_id = v.store_id AND pv.id = v.product_id
          WHERE v.store_id = $1::uuid AND (NOT $2::boolean OR pv.published))::text AS variantes,
       (SELECT count(*) FROM categories c WHERE c.store_id = $1::uuid
          AND (NOT $2::boolean OR EXISTS (SELECT 1 FROM products pc WHERE pc.store_id = c.store_id AND pc.published
                                           AND pc.categories @> jsonb_build_array(jsonb_build_object('id', c.id)))))::text AS categorias,
       (count(*) FILTER (WHERE ${escopo} AND p.image_count = 0))::text AS "semImagem",
       (count(*) FILTER (WHERE ${escopo} AND jsonb_array_length(p.categories) = 0))::text AS "semCategoria",
       (count(*) FILTER (WHERE ${escopo} AND EXISTS (SELECT 1 FROM variants v WHERE v.store_id = p.store_id AND v.product_id = p.id AND (v.sku IS NULL OR v.sku = ''))))::text AS "semSku",
       (count(*) FILTER (WHERE ${escopo} AND EXISTS (SELECT 1 FROM variants v WHERE v.store_id = p.store_id AND v.product_id = p.id AND v.stock_management AND coalesce(v.stock, 0) <= 0)))::text AS "semEstoque",
       (count(*) FILTER (WHERE ${escopo} AND (p.description IS NULL OR btrim(p.description) = '')))::text AS "semDescricao"
     FROM products p WHERE p.store_id = $1::uuid`,
    [storeId, opcoes.soPublicados === true],
  );
  const r = rows[0]!;
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v)])) as unknown as CatalogStats;
}
