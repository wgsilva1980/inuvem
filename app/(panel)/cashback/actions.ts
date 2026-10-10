"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/admin";
import { obterConfig, salvarConfig } from "@/lib/cashback/repo";
import { validarConfig } from "@/lib/cashback/rules";
import { query } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";

export interface CashbackState {
  ok?: boolean;
  message?: string;
}

const db = { query };

/** Salva as regras do cashback. Mudar as regras não altera cupons já emitidos. */
export async function salvarRegrasAction(_prev: CashbackState | null, formData: FormData): Promise<CashbackState> {
  const admin = await requireAdmin();
  const store = await getActiveStore();
  if (!store) return { message: "Nenhuma loja conectada." };
  const g = (n: string) => String(formData.get(n) ?? "");
  const v = validarConfig({ percent: g("percent"), minOrder: g("minOrder"), minPurchase: g("minPurchase"), maxValue: g("maxValue"), validDays: g("validDays"), waitDays: g("waitDays"), monthBudget: g("monthBudget") });
  if (!v.ok) return { message: v.error };
  const antes = await obterConfig(db, store.id);
  await salvarConfig(db, store.id, v.value, admin.email);
  await db.query(`INSERT INTO audit_log (store_id, actor_email, acao, entidade, antes, depois, sucesso) VALUES ($1::uuid, $2, 'cashback.regras', 'loja', $3::jsonb, $4::jsonb, true)`, [store.id, admin.email, JSON.stringify(antes), JSON.stringify(v.value)]);
  revalidatePath("/cashback");
  return { ok: true, message: "Regras salvas." };
}
