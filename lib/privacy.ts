import type { Db } from "@/lib/sync/repo";

/**
 * LGPD `store/redact`: a Nuvemshop pede a remoção dos dados da loja (≈48 h após a desinstalação).
 * Todas as tabelas referenciam `stores` com ON DELETE CASCADE, então um DELETE basta (inclui o token).
 * Idempotente. Devolve quantas lojas foram removidas.
 */
export async function redactStore(db: Db, nuvemshopStoreId: number): Promise<number> {
  const rows = await db.query<{ id: string }>("DELETE FROM stores WHERE nuvemshop_store_id = $1 RETURNING id", [nuvemshopStoreId]);
  return rows.length;
}
