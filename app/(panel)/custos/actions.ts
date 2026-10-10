"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/admin";
import { margemMinima, salvarMargemMinima } from "@/lib/costs/repo";
import { query } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";

export interface CustosState {
  ok?: boolean;
  message?: string;
}

/** Margem mínima desejada sobre o preço de venda. O painel não deixa lote, promoção nem liquidação baixar o preço abaixo dela (nem do custo). */
export async function salvarMargemAction(_prev: CustosState | null, formData: FormData): Promise<CustosState> {
  const admin = await requireAdmin();
  const store = await getActiveStore();
  if (!store) return { message: "Nenhuma loja conectada." };
  const n = Number(String(formData.get("margem") ?? "").trim().replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n >= 100) return { message: "A margem mínima deve ser de 0 a menos de 100%." };
  const valor = Math.round(n * 100) / 100;
  const db = { query };
  const antes = await margemMinima(db, store.id);
  await salvarMargemMinima(db, store.id, valor, admin.email);
  await db.query(`INSERT INTO audit_log (store_id, actor_email, acao, entidade, antes, depois, sucesso) VALUES ($1::uuid, $2, 'custo.margem_minima', 'loja', $3::jsonb, $4::jsonb, true)`, [
    store.id,
    admin.email,
    JSON.stringify({ margem: antes }),
    JSON.stringify({ margem: valor }),
  ]);
  revalidatePath("/custos");
  return { ok: true, message: valor === 0 ? "Margem mínima: 0%. O painel só impede preços abaixo do custo." : `Margem mínima de ${valor.toLocaleString("pt-BR")}% salva.` };
}
