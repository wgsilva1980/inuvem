"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/admin";
import { salvarAutoDespublicar } from "@/lib/automations/out-of-stock";
import { query } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";

export interface AutomacaoState {
  ok?: boolean;
  message?: string;
}

/** Liga ou desliga a regra “despublicar produto sem estoque”. */
export async function salvarAutomacaoAction(_prev: AutomacaoState | null, formData: FormData): Promise<AutomacaoState> {
  const admin = await requireAdmin();
  const store = await getActiveStore();
  if (!store) return { message: "Nenhuma loja conectada." };
  const ligado = formData.get("auto_despublicar") === "on";
  await salvarAutoDespublicar({ query }, store.id, ligado, admin.email);
  revalidatePath("/automacoes");
  return { ok: true, message: ligado ? "Regra ligada: produtos sem estoque em todas as variações serão despublicados." : "Regra desligada." };
}
