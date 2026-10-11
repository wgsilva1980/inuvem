"use server";

import { revalidatePath } from "next/cache";
import { AlertaConfigError, obterConfigAlertas, salvarConfigAlertas } from "@/lib/alerts/service";
import { requireAdmin } from "@/lib/auth/admin";
import { query } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";

export interface AlertasState {
  ok?: boolean;
  message?: string;
}

export async function salvarAlertasAction(_prev: AlertasState | null, formData: FormData): Promise<AlertasState> {
  const admin = await requireAdmin();
  const store = await getActiveStore();
  if (!store) return { message: "Nenhuma loja conectada." };
  const db = { query };
  const recipients = String(formData.get("destinatarios") ?? "")
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const resumo = (c: { enabled: boolean; recipients: string[]; onPaidOrder: boolean; onOutOfStock: boolean; onSyncFailure: boolean }) => ({ ligado: c.enabled, destinatarios: c.recipients.length, pedidoPago: c.onPaidOrder, esgotado: c.onOutOfStock, syncFalhou: c.onSyncFailure });
  try {
    const antes = await obterConfigAlertas(db, store.id);
    const depois = await salvarConfigAlertas(db, {
      storeId: store.id,
      actor: admin.email,
      enabled: formData.get("enabled") === "on",
      recipients,
      onPaidOrder: formData.get("pedidoPago") === "on",
      onOutOfStock: formData.get("esgotado") === "on",
      onSyncFailure: formData.get("syncFalhou") === "on",
    });
    await db.query(`INSERT INTO audit_log (store_id, actor_email, acao, entidade, antes, depois, sucesso) VALUES ($1::uuid, $2, 'alertas.configurar', 'loja', $3::jsonb, $4::jsonb, true)`, [store.id, admin.email, JSON.stringify(resumo(antes)), JSON.stringify(resumo(depois))]);
  } catch (err) {
    if (err instanceof AlertaConfigError) return { message: err.message };
    throw err;
  }
  revalidatePath("/alertas");
  return { ok: true, message: "Configuração salva." };
}
