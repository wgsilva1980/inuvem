"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/admin";
import { createRevertJob } from "@/lib/bulk/engine";
import { operationFromForm } from "@/lib/bulk/form";
import { countVariantChanges, describeOperation, planOperation } from "@/lib/bulk/operations";
import { JobStateError, cancelJob, createJob, loadMirrorProducts, startJob } from "@/lib/bulk/repo";
import { resolveSelection } from "@/lib/bulk/selection";
import { listCategoryOptions } from "@/lib/catalog/query";
import { query } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";

export interface BulkFormState {
  message?: string;
}

const db = { query };

/** Calcula a pré-visualização e cria o lote (nada é enviado à loja aqui). */
export async function createBulk(_prev: BulkFormState | null, formData: FormData): Promise<BulkFormState> {
  const admin = await requireAdmin();
  const store = await getActiveStore();
  if (!store) return { message: "Nenhuma loja conectada." };

  const form = operationFromForm((name) => String(formData.get(name) ?? ""));
  if (!form.op) return { message: form.error };
  const op = form.op;

  const selection = await resolveSelection(db, store.id, Object.fromEntries(new URLSearchParams(String(formData.get("selecao") ?? ""))));
  if (selection.ids.length === 0) return { message: "Nenhum produto selecionado." };
  if (selection.truncated) return { message: "Mais de 500 produtos selecionados. Refine o filtro ou marque menos produtos." };

  const categories = await listCategoryOptions(db, store.id);
  if (op.type === "categoria" && !categories.some((c) => c.id === op.categoryId)) return { message: "Categoria não encontrada. Sincronize e tente de novo." };
  const nameOf = (id: number) => categories.find((c) => c.id === id)?.name ?? `#${id}`;

  const plan = planOperation(op, await loadMirrorProducts(db, store.id, selection.ids));
  if (plan.items.length === 0) {
    const motivos = [...new Set(plan.ignorados.map((i) => i.motivo))].slice(0, 4).join("; ");
    return { message: `Nada a alterar nesta seleção${motivos ? `: ${motivos}` : ""}.` };
  }

  const jobId = await createJob(db, { storeId: store.id, actor: admin.email, operation: op, descricao: describeOperation(op, nameOf), plan });
  await db.query(
    `INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, depois, sucesso) VALUES ($1::uuid, $2, 'lote.criar', 'lote', $3, $4::jsonb, true)`,
    [store.id, admin.email, jobId, JSON.stringify({ descricao: describeOperation(op, nameOf), produtos: plan.items.length, variantes: countVariantChanges(plan.items), ignorados: plan.ignorados.length })],
  );
  redirect(`/lote/${jobId}`);
}

export interface JobActionResult {
  ok: boolean;
  message?: string;
}

async function withStore<T>(fn: (storeId: string, actor: string) => Promise<T>): Promise<T | JobActionResult> {
  const admin = await requireAdmin();
  const store = await getActiveStore();
  if (!store) return { ok: false, message: "Nenhuma loja conectada." };
  try {
    return await fn(store.id, admin.email);
  } catch (err) {
    if (err instanceof JobStateError) return { ok: false, message: err.message };
    console.error(JSON.stringify({ level: "error", event: "bulk.action.failed", message: err instanceof Error ? err.message : String(err) }));
    return { ok: false, message: "Falha inesperada. Tente novamente." };
  }
}

/** Confirmação do usuário: a partir daqui o lote passa a escrever na loja (a tela chama o passo repetidamente). */
export async function startBulk(jobId: string): Promise<JobActionResult> {
  const r = await withStore(async (storeId, actor) => {
    await startJob(db, storeId, jobId);
    await db.query(`INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, sucesso) VALUES ($1::uuid, $2, 'lote.iniciar', 'lote', $3, true)`, [storeId, actor, jobId]);
    return { ok: true } as JobActionResult;
  });
  revalidatePath(`/lote/${jobId}`);
  return r;
}

export async function cancelBulk(jobId: string): Promise<JobActionResult> {
  const r = await withStore(async (storeId, actor) => {
    const done = await cancelJob(db, storeId, jobId);
    if (done) await db.query(`INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, sucesso) VALUES ($1::uuid, $2, 'lote.cancelar', 'lote', $3, true)`, [storeId, actor, jobId]);
    return { ok: done, message: done ? undefined : "Este lote já terminou ou foi cancelado." } as JobActionResult;
  });
  revalidatePath(`/lote/${jobId}`);
  return r;
}

export async function revertBulk(jobId: string): Promise<JobActionResult> {
  let newId: string | null = null;
  const r = await withStore(async (storeId, actor) => {
    newId = await createRevertJob(db, { storeId, actor, jobId });
    await db.query(`INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, depois, sucesso) VALUES ($1::uuid, $2, 'lote.reverter', 'lote', $3, $4::jsonb, true)`, [storeId, actor, jobId, JSON.stringify({ novo_lote: newId })]);
    return { ok: true } as JobActionResult;
  });
  if (newId) redirect(`/lote/${newId}`);
  return r;
}
