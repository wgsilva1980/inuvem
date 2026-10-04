import "server-only";
import { query, queryOne } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { getEnv, userAgent } from "@/lib/env";
import { NuvemshopClient } from "@/lib/nuvemshop";

export interface StoreRow {
  id: string;
  nuvemshop_store_id: string; // bigint chega como string
  name: string | null;
  url: string | null;
  scope: string | null;
  created_at: string;
}

const PUBLIC_COLUMNS = "id, nuvemshop_store_id, name, url, scope, created_at";

/** v1: o painel administra uma loja só (o schema já é multi-loja). */
export async function getActiveStore(): Promise<StoreRow | null> {
  return queryOne<StoreRow>(`SELECT ${PUBLIC_COLUMNS} FROM stores ORDER BY created_at LIMIT 1`);
}

export async function saveStore(input: { nuvemshopStoreId: number; accessToken: string; scope: string }): Promise<StoreRow> {
  const encrypted = encrypt(input.accessToken, getEnv().ENCRYPTION_KEY);
  const rows = await query<StoreRow>(
    `INSERT INTO stores (nuvemshop_store_id, access_token_encrypted, scope)
     VALUES ($1, $2, $3)
     ON CONFLICT (nuvemshop_store_id) DO UPDATE
       SET access_token_encrypted = EXCLUDED.access_token_encrypted, scope = EXCLUDED.scope, updated_at = now()
     RETURNING ${PUBLIC_COLUMNS}`,
    [input.nuvemshopStoreId, encrypted, input.scope],
  );
  return rows[0]!;
}

export async function updateStoreProfile(id: string, profile: { name?: string; url?: string }): Promise<void> {
  await query("UPDATE stores SET name = COALESCE($2, name), url = COALESCE($3, url), updated_at = now() WHERE id = $1", [
    id,
    profile.name ?? null,
    profile.url ?? null,
  ]);
}

/** Cliente da API com o token descriptografado — só existe no servidor. */
export async function clientForStore(store: Pick<StoreRow, "id" | "nuvemshop_store_id">): Promise<NuvemshopClient> {
  const env = getEnv();
  const row = await queryOne<{ access_token_encrypted: string }>(
    "SELECT access_token_encrypted FROM stores WHERE id = $1",
    [store.id],
  );
  if (!row) throw new Error("Loja não encontrada");
  return new NuvemshopClient({
    storeId: store.nuvemshop_store_id,
    accessToken: decrypt(row.access_token_encrypted, env.ENCRYPTION_KEY),
    userAgent: userAgent(env),
    apiVersion: env.NUVEMSHOP_API_VERSION,
  });
}
