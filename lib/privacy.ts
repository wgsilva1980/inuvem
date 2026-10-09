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

/**
 * LGPD `customers/redact`: apaga o cliente espelhado e o contato ligado a ele (nome, e-mail, telefone, documento, endereço, observações).
 * Idempotente. Devolve quantos registros de cliente foram removidos.
 */
export async function redactCustomer(db: Db, nuvemshopStoreId: number, customerId: number): Promise<number> {
  const lojas = await db.query<{ id: string }>("SELECT id FROM stores WHERE nuvemshop_store_id = $1", [nuvemshopStoreId]);
  if (lojas.length === 0) return 0;
  const storeId = lojas[0]!.id;
  await db.query("UPDATE orders SET customer_id = NULL WHERE store_id = $1::uuid AND customer_id = $2::bigint", [storeId, customerId]);
  await db.query("DELETE FROM contacts WHERE store_id = $1::uuid AND nuvemshop_customer_id = $2::bigint", [storeId, customerId]);
  const rows = await db.query<{ id: string }>("DELETE FROM customers WHERE store_id = $1::uuid AND id = $2::bigint RETURNING id", [storeId, customerId]);
  return rows.length;
}
