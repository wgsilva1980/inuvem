import type { SkuContexto } from "@/lib/bulk/operations";
import type { Db } from "@/lib/sync/repo";

const NUMERICO = "^[0-9]{1,15}$";

/** Maior SKU numérico da loja (0 se não houver). Os códigos da loja são números sequenciais; o próximo é este + 1. */
async function maiorSku(db: Db, storeId: string): Promise<number> {
  const rows = await db.query<{ maior: string | null }>(
    `SELECT max(sku::bigint)::text AS maior FROM variants WHERE store_id = $1::uuid AND sku ~ '${NUMERICO}'`,
    [storeId],
  );
  return Number(rows[0]?.maior ?? 0);
}

/** Os próximos `quantidade` códigos livres, em sequência (ex.: 1015, 1016…). */
export async function proximosSkus(db: Db, storeId: string, quantidade: number): Promise<string[]> {
  const inicio = (await maiorSku(db, storeId)) + 1;
  return Array.from({ length: quantidade }, (_, i) => String(inicio + i));
}

/** Contexto para o lote de SKU: próximo número livre e o dono de cada código (a variante mais antiga que o usa). */
export async function contextoSku(db: Db, storeId: string): Promise<SkuContexto> {
  const donos = await db.query<{ sku: string; id: string }>(
    `SELECT DISTINCT ON (btrim(sku)) btrim(sku) AS sku, id::text AS id FROM variants
     WHERE store_id = $1::uuid AND btrim(coalesce(sku, '')) <> ''
     ORDER BY btrim(sku), product_id, position NULLS LAST, id`,
    [storeId],
  );
  return { proximo: (await maiorSku(db, storeId)) + 1, donos: new Map(donos.map((d) => [d.sku, Number(d.id)])) };
}
