import { catalogParamsSchema, paramsToFilters } from "@/lib/catalog/params";
import { listProductIds } from "@/lib/catalog/query";
import type { Db } from "@/lib/sync/repo";
import { MAX_PRODUCTS_PER_JOB } from "./operations";

export interface Selection {
  ids: number[];
  /** Mais produtos casaram do que o limite do lote. */
  truncated: boolean;
  /** Texto para mostrar de onde veio a seleção. */
  origem: string;
}

/**
 * Seleção de produtos de um lote, a partir da URL: `ids=1,2,3` (marcados na lista) ou os mesmos filtros da lista
 * (todos os resultados). Sempre resolvida no servidor, contra o espelho da loja.
 */
export async function resolveSelection(db: Db, storeId: string, sp: Record<string, string | undefined>): Promise<Selection> {
  if (sp.ids) {
    const ids = [...new Set(sp.ids.split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0))];
    const found = await db.query<{ id: string }>("SELECT id::text AS id FROM products WHERE store_id = $1::uuid AND id = ANY($2::bigint[])", [storeId, ids.slice(0, MAX_PRODUCTS_PER_JOB + 1)]);
    const valid = found.map((r) => Number(r.id));
    return { ids: valid.slice(0, MAX_PRODUCTS_PER_JOB), truncated: valid.length > MAX_PRODUCTS_PER_JOB, origem: "produtos marcados na lista" };
  }
  const filters = paramsToFilters(catalogParamsSchema.parse(sp));
  const { ids, truncated } = await listProductIds(db, storeId, filters, MAX_PRODUCTS_PER_JOB);
  return { ids, truncated, origem: "todos os produtos do filtro" };
}
