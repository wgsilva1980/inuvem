"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/admin";
import { definirManterDespublicado, salvarAutoRepublicar } from "@/lib/automations/in-stock";
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

/** Liga ou desliga a regra “publicar de novo quando o estoque voltar” (só vale para produtos que a regra “sem estoque” despublicou). */
export async function salvarRepublicarAction(_prev: AutomacaoState | null, formData: FormData): Promise<AutomacaoState> {
  const admin = await requireAdmin();
  const store = await getActiveStore();
  if (!store) return { message: "Nenhuma loja conectada." };
  const ligado = formData.get("auto_republicar") === "on";
  await salvarAutoRepublicar({ query }, store.id, ligado, admin.email);
  revalidatePath("/automacoes");
  return { ok: true, message: ligado ? "Regra ligada: produtos despublicados por falta de estoque voltam quando o estoque voltar." : "Regra desligada." };
}

/** Marca (ou desmarca) um produto para NÃO voltar sozinho quando o estoque voltar. */
export async function manterDespublicadoAction(productId: number, manter: boolean): Promise<AutomacaoState> {
  await requireAdmin();
  const store = await getActiveStore();
  if (!store || !Number.isInteger(productId) || productId <= 0) return { message: "Produto inválido." };
  const ok = await definirManterDespublicado({ query }, store.id, productId, manter);
  revalidatePath("/automacoes");
  return ok ? { ok: true } : { message: "Este produto não está mais na lista de espera." };
}
