import type { Db } from "@/lib/sync/repo";
import { pt, type I18n } from "@/lib/nuvemshop/types";
import { buildCatalogWhere, type CatalogFilters } from "./query";

/** Limite de linhas (variações) por planilha. */
export const EXPORT_PRODUTOS_MAX = 20000;

export interface LinhaProduto {
  produto_id: string;
  produto: string;
  publicado: boolean;
  categorias: string;
  variacao_id: string | null;
  variacao: string;
  sku: string | null;
  preco: string | null;
  preco_promocional: string | null;
  controla_estoque: boolean | null;
  estoque: number | null;
  peso: string | null;
  altura: string | null;
  largura: string | null;
  profundidade: string | null;
  imagens: number;
  atualizado_em: string | null;
}

function nomeCategoria(name: unknown): string {
  return typeof name === "string" ? name : name && typeof name === "object" ? pt(name as I18n) : "";
}

/** Uma linha por variação dos produtos que casam com os filtros da tela (mesma ordem da lista, sem paginação). */
export async function listarProdutosParaExportar(db: Db, storeId: string, filters: CatalogFilters): Promise<{ linhas: LinhaProduto[]; truncado: boolean }> {
  const { whereSql, params } = buildCatalogWhere(storeId, { ...filters, page: undefined });
  const order = filters.sort === "atualizados" ? "p.updated_at_remote DESC NULLS LAST, p.id DESC" : "lower(p.name), p.id";
  const rows = await db.query<Omit<LinhaProduto, "categorias" | "variacao"> & { categories: unknown; values: unknown }>(
    `SELECT p.id::text AS produto_id, p.name AS produto, p.published AS publicado, p.categories, p.image_count AS imagens,
            to_char(p.updated_at_remote AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') AS atualizado_em,
            v.id::text AS variacao_id, v.values, v.sku, v.price::text AS preco, v.promotional_price::text AS preco_promocional,
            v.stock_management AS controla_estoque, v.stock AS estoque, v.weight::text AS peso,
            v.height::text AS altura, v.width::text AS largura, v.depth::text AS profundidade
     FROM products p
     LEFT JOIN variants v ON v.store_id = p.store_id AND v.product_id = p.id
     WHERE ${whereSql}
     ORDER BY ${order}, v.position NULLS LAST, v.id
     LIMIT ${EXPORT_PRODUTOS_MAX + 1}`,
    params,
  );
  const linhas = rows.slice(0, EXPORT_PRODUTOS_MAX).map(({ categories, values, ...r }) => ({
    ...r,
    categorias: Array.isArray(categories) ? categories.map((c) => nomeCategoria((c as { name?: unknown }).name)).filter(Boolean).join(", ") : "",
    variacao: Array.isArray(values) ? values.map((x) => pt(x as I18n)).filter(Boolean).join(" / ") : "",
  }));
  return { linhas, truncado: rows.length > EXPORT_PRODUTOS_MAX };
}
