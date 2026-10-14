import type { Db } from "@/lib/sync/repo";

/**
 * Custo da variação para ler junto com a linha de `variants` (a consulta precisa se chamar `variants`, sem apelido): o do painel, se houver,
 * senão o que a loja guarda no campo `cost` da variação. Texto com 2 casas, ou null quando não há custo.
 */
export const SQL_CUSTO_DA_VARIACAO = `coalesce(
  (SELECT c.cost::text FROM variant_costs c WHERE c.store_id = variants.store_id AND c.variant_id = variants.id),
  CASE WHEN coalesce(variants.raw_json->>'cost', '') ~ '^[0-9]+(\\.[0-9]+)?$' AND (variants.raw_json->>'cost')::numeric > 0 THEN to_char((variants.raw_json->>'cost')::numeric, 'FM999999990.00') END
) AS cost`;

/** Grava (ou apaga, com `cost` null) o custo da variação no painel. */
export async function gravarCustoDaVariacao(db: Db, args: { storeId: string; productId: number; variantId: number; cost: string | null; actor: string }): Promise<void> {
  if (args.cost === null) {
    await db.query("DELETE FROM variant_costs WHERE store_id = $1::uuid AND variant_id = $2::bigint", [args.storeId, args.variantId]);
    return;
  }
  await db.query(
    `INSERT INTO variant_costs (store_id, variant_id, product_id, cost, updated_at, updated_by) VALUES ($1::uuid, $2::bigint, $3::bigint, $4::numeric, now(), $5)
     ON CONFLICT (store_id, variant_id) DO UPDATE SET product_id = EXCLUDED.product_id, cost = EXCLUDED.cost, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [args.storeId, args.variantId, args.productId, args.cost, args.actor],
  );
}

/**
 * O custo do produto (usado em Custos, no Simulador e nas margens) passa a ser a média dos custos das suas variações que têm custo. Produto sem nenhum
 * custo de variação não é tocado (continua com o custo que já tinha). Devolve o custo gravado, ou null se não mexeu.
 */
export async function sincronizarCustoDoProduto(db: Db, storeId: string, productId: number, actor: string): Promise<number | null> {
  const rows = await db.query<{ custo: string }>(
    `INSERT INTO product_costs (store_id, product_id, cost, source, updated_at, updated_by)
     SELECT $1::uuid, $2::bigint, round(avg(c.cost), 2), 'manual', now(), $3
     FROM variant_costs c WHERE c.store_id = $1::uuid AND c.product_id = $2::bigint
     HAVING count(*) > 0
     ON CONFLICT (store_id, product_id) DO UPDATE SET cost = EXCLUDED.cost, source = 'manual', updated_at = now(), updated_by = EXCLUDED.updated_by
     RETURNING cost::text AS custo`,
    [storeId, productId, actor],
  );
  return rows[0] ? Number(rows[0].custo) : null;
}
