import type { Db } from "@/lib/sync/repo";

export interface ResumoVendas {
  sincronizadoEm: string | null;
  janelaDias: number | null;
}

/** Quando o resumo de vendas por produto (usado na liquidação) foi refeito pela última vez, e a janela de dias que ele cobre. */
export async function resumoVendas(db: Db, storeId: string): Promise<ResumoVendas> {
  const [r] = await db.query<{ quando: string | null; dias: number | null }>("SELECT sales_synced_at::text AS quando, sales_window_days AS dias FROM store_settings WHERE store_id = $1::uuid", [storeId]);
  return { sincronizadoEm: r?.quando ?? null, janelaDias: r?.dias ?? null };
}
