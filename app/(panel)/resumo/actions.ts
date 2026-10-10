"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/admin";
import { query } from "@/lib/db";
import { ResumoConfigError, obterConfigResumo, salvarConfigResumo } from "@/lib/digest/service";
import { getActiveStore } from "@/lib/stores";

export interface ResumoState {
  ok?: boolean;
  message?: string;
}

export async function salvarResumoAction(_prev: ResumoState | null, formData: FormData): Promise<ResumoState> {
  const admin = await requireAdmin();
  const store = await getActiveStore();
  if (!store) return { message: "Nenhuma loja conectada." };
  const db = { query };
  const recipients = String(formData.get("destinatarios") ?? "")
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  try {
    const antes = await obterConfigResumo(db, store.id);
    const depois = await salvarConfigResumo(db, { storeId: store.id, actor: admin.email, enabled: formData.get("enabled") === "on", recipients, onlyIfAction: formData.get("somenteComAcao") === "on" });
    await db.query(`INSERT INTO audit_log (store_id, actor_email, acao, entidade, antes, depois, sucesso) VALUES ($1::uuid, $2, 'resumo.configurar', 'loja', $3::jsonb, $4::jsonb, true)`, [
      store.id,
      admin.email,
      JSON.stringify({ ligado: antes.enabled, destinatarios: antes.recipients.length, somenteComAcao: antes.onlyIfAction }),
      JSON.stringify({ ligado: depois.enabled, destinatarios: depois.recipients.length, somenteComAcao: depois.onlyIfAction }),
    ]);
  } catch (err) {
    if (err instanceof ResumoConfigError) return { message: err.message };
    throw err;
  }
  revalidatePath("/resumo");
  return { ok: true, message: "Configuração salva." };
}
