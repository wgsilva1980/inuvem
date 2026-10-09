"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/admin";
import { parseDecimal } from "@/lib/bulk/form";
import { operationSchema, planOperation, validateOperation } from "@/lib/bulk/operations";
import { loadMirrorProducts } from "@/lib/bulk/repo";
import { resolveSelection } from "@/lib/bulk/selection";
import { query } from "@/lib/db";
import { PromocaoError, cancelPromotion, createPromotion } from "@/lib/promotions/repo";
import { getActiveStore } from "@/lib/stores";

export interface PromoFormState {
  message?: string;
}

const db = { query };

/** Agenda a promoção: valida, confere que há o que alterar e grava a agenda (nada vai à loja agora). */
export async function criarPromocao(_prev: PromoFormState | null, formData: FormData): Promise<PromoFormState> {
  const admin = await requireAdmin();
  const store = await getActiveStore();
  if (!store) return { message: "Nenhuma loja conectada." };

  const percent = parseDecimal(String(formData.get("percent") ?? ""));
  if (percent === null) return { message: "Informe o percentual de desconto (por exemplo 15)." };
  const rounding = ["nenhum", "90", "00"].includes(String(formData.get("arredondar"))) ? String(formData.get("arredondar")) : "nenhum";
  const parsed = operationSchema.safeParse({ type: "promocao", mode: "desconto", percent, rounding });
  if (!parsed.success) return { message: "O desconto precisa ser maior que 0% e menor que 100%." };
  const problem = validateOperation(parsed.data);
  if (problem) return { message: problem };

  const selection = await resolveSelection(db, store.id, Object.fromEntries(new URLSearchParams(String(formData.get("selecao") ?? ""))));
  if (selection.ids.length === 0) return { message: "Nenhum produto selecionado." };
  if (selection.truncated) return { message: "Mais de 500 produtos selecionados. Refine o filtro ou marque menos produtos." };

  const plan = planOperation(parsed.data, await loadMirrorProducts(db, store.id, selection.ids));
  if (plan.items.length === 0) {
    const motivos = [...new Set(plan.ignorados.map((i) => i.motivo))].slice(0, 3).join("; ");
    return { message: `Nada a alterar nesta seleção${motivos ? `: ${motivos}` : ""}.` };
  }

  let id: string;
  try {
    id = await createPromotion(db, {
      storeId: store.id,
      actor: admin.email,
      nome: String(formData.get("nome") ?? ""),
      operation: parsed.data,
      productIds: selection.ids,
      inicioLocal: String(formData.get("inicio") ?? ""),
      fimLocal: String(formData.get("fim") ?? ""),
    });
  } catch (err) {
    if (err instanceof PromocaoError) return { message: err.message };
    throw err;
  }
  await db.query(
    `INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, depois, sucesso) VALUES ($1::uuid, $2, 'promocao.criar', 'promocao', $3, $4::jsonb, true)`,
    [store.id, admin.email, id, JSON.stringify({ nome: String(formData.get("nome") ?? "").trim(), produtos: plan.items.length, desconto: percent })],
  );
  redirect(`/promocoes/${id}`);
}

export async function cancelarPromocao(id: string): Promise<{ ok: boolean; message?: string }> {
  const admin = await requireAdmin();
  const store = await getActiveStore();
  if (!store) return { ok: false, message: "Nenhuma loja conectada." };
  const done = await cancelPromotion(db, store.id, id);
  if (done) {
    await db.query(`INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, sucesso) VALUES ($1::uuid, $2, 'promocao.cancelar', 'promocao', $3, true)`, [store.id, admin.email, id]);
  }
  revalidatePath("/promocoes");
  revalidatePath(`/promocoes/${id}`);
  return { ok: done, message: done ? undefined : "Só dá para cancelar uma promoção que ainda não começou. Se já está no ar, use Encerrar agora." };
}
