"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/admin";
import { BlocoError, excluirBloco, obterBloco, salvarBloco } from "@/lib/content/blocks";
import { query } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";

export interface BlocoFormState {
  message?: string;
}

const db = { query };

/** Cria ou atualiza um bloco. Atualizar o bloco NÃO muda as descrições já publicadas: para isso, aplique-o de novo num lote. */
export async function salvarBlocoAction(_prev: BlocoFormState | null, formData: FormData): Promise<BlocoFormState> {
  const admin = await requireAdmin();
  const store = await getActiveStore();
  if (!store) return { message: "Nenhuma loja conectada." };
  const id = String(formData.get("id") ?? "") || undefined;
  try {
    const salvoId = await salvarBloco(db, { storeId: store.id, actor: admin.email, id, name: String(formData.get("nome") ?? ""), html: String(formData.get("html") ?? "") });
    await db.query(
      `INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, depois, sucesso) VALUES ($1::uuid, $2, $3, 'bloco', $4, $5::jsonb, true)`,
      [store.id, admin.email, id ? "bloco.atualizar" : "bloco.criar", salvoId, JSON.stringify({ nome: String(formData.get("nome") ?? "").trim() })],
    );
  } catch (err) {
    if (err instanceof BlocoError) return { message: err.message };
    throw err;
  }
  revalidatePath("/conteudo");
  redirect("/conteudo?salvo=1");
}

export async function excluirBlocoAction(id: string): Promise<BlocoFormState> {
  const admin = await requireAdmin();
  const store = await getActiveStore();
  if (!store) return { message: "Nenhuma loja conectada." };
  const bloco = await obterBloco(db, store.id, id);
  if (!bloco) return { message: "Bloco não encontrado." };
  await excluirBloco(db, store.id, id);
  await db.query(`INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, antes, sucesso) VALUES ($1::uuid, $2, 'bloco.excluir', 'bloco', $3, $4::jsonb, true)`, [store.id, admin.email, id, JSON.stringify({ nome: bloco.name })]);
  revalidatePath("/conteudo");
  redirect("/conteudo?excluido=1");
}
