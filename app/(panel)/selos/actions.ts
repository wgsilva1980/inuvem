"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/admin";
import { obterConfig, salvarConfig, validarConfig } from "@/lib/badges/settings";
import { query } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";

export interface SelosState {
  ok?: boolean;
  message?: string;
}

const db = { query };

/** Salva os selos. “Ligado” é o interruptor geral: desligado, a vitrine não mostra nada (o script colado na loja continua lá, sem efeito). */
export async function salvarSelosAction(_prev: SelosState | null, formData: FormData): Promise<SelosState> {
  const admin = await requireAdmin();
  const store = await getActiveStore();
  if (!store) return { message: "Nenhuma loja conectada." };
  const on = (n: string) => formData.get(n) === "on";
  const v = validarConfig({
    enabled: on("enabled"),
    lowStockEnabled: on("lowStockEnabled"),
    lowStockMax: Number(formData.get("lowStockMax")),
    countdownEnabled: on("countdownEnabled"),
    whatsappEnabled: on("whatsappEnabled"),
    whatsappNumber: String(formData.get("whatsappNumber") ?? ""),
    whatsappMessage: String(formData.get("whatsappMessage") ?? ""),
  });
  if (!v.ok) return { message: v.error };
  const antes = await obterConfig(db, store.id);
  await salvarConfig(db, store.id, v.value, admin.email);
  await db.query(
    `INSERT INTO audit_log (store_id, actor_email, acao, entidade, antes, depois, sucesso) VALUES ($1::uuid, $2, 'selos.configurar', 'loja', $3::jsonb, $4::jsonb, true)`,
    [store.id, admin.email, JSON.stringify(antes), JSON.stringify(v.value)],
  );
  revalidatePath("/selos");
  return { ok: true, message: v.value.enabled ? "Selos ligados. A vitrine passa a mostrá-los em até 1 minuto." : "Selos desligados: a vitrine não mostra nada." };
}
