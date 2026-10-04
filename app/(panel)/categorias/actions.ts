"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/admin";
import { CategoryRuleError, categoryEditSchema, createCategory, deleteCategory, updateCategory, type CategoryApi } from "@/lib/categories/manage";
import { query } from "@/lib/db";
import { NuvemshopError, createCategory as apiCreate, deleteCategory as apiDelete, getCategory, updateCategory as apiUpdate } from "@/lib/nuvemshop";
import { clientForStore, getActiveStore } from "@/lib/stores";

export interface CategoryActionState {
  ok?: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
}

const db = { query };

async function run(task: (ctx: { storeId: string; actor: string; api: CategoryApi }) => Promise<string>): Promise<CategoryActionState> {
  const admin = await requireAdmin();
  const store = await getActiveStore();
  if (!store) return { message: "Nenhuma loja conectada." };
  try {
    const client = await clientForStore(store);
    const api: CategoryApi = {
      get: (id) => getCategory(client, id),
      create: (input) => apiCreate(client, input),
      update: (id, input) => apiUpdate(client, id, input),
      remove: (id) => apiDelete(client, id),
    };
    const message = await task({ storeId: store.id, actor: admin.email, api });
    return { ok: true, message };
  } catch (err) {
    if (err instanceof CategoryRuleError) return { message: err.message };
    if (err instanceof NuvemshopError) return { message: err.userMessage };
    console.error(JSON.stringify({ level: "error", event: "category.action.failed", message: err instanceof Error ? err.message : String(err) }));
    return { message: "Falha inesperada. Tente novamente." };
  } finally {
    revalidatePath("/categorias");
    revalidatePath("/produtos");
  }
}

function parse(formData: FormData): { edit: ReturnType<typeof categoryEditSchema.parse> } | { state: CategoryActionState } {
  const parsed = categoryEditSchema.safeParse({ name: formData.get("name") ?? "", parent: formData.get("parent") ?? "" });
  if (parsed.success) return { edit: parsed.data };
  const fieldErrors: Record<string, string> = {};
  for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
  return { state: { message: "Corrija os campos destacados.", fieldErrors } };
}

export async function createCategoryAction(_prev: CategoryActionState | null, formData: FormData): Promise<CategoryActionState> {
  const p = parse(formData);
  if ("state" in p) return p.state;
  return run(async ({ storeId, actor, api }) => {
    await createCategory(db, api, { storeId, actor, edit: p.edit });
    return "Categoria criada na Nuvemshop.";
  });
}

export async function updateCategoryAction(id: number, _prev: CategoryActionState | null, formData: FormData): Promise<CategoryActionState> {
  if (!Number.isInteger(id) || id <= 0) return { message: "Categoria inválida." };
  const p = parse(formData);
  if ("state" in p) return p.state;
  return run(async ({ storeId, actor, api }) => {
    const r = await updateCategory(db, api, { storeId, actor, id, edit: p.edit });
    return r.changed ? "Categoria atualizada na Nuvemshop." : "Nada foi alterado.";
  });
}

export async function deleteCategoryAction(id: number): Promise<CategoryActionState> {
  if (!Number.isInteger(id) || id <= 0) return { message: "Categoria inválida." };
  return run(async ({ storeId, actor, api }) => {
    const r = await deleteCategory(db, api, { storeId, actor, id });
    return r.produtos > 0 ? `Categoria apagada. ${r.produtos} ${r.produtos === 1 ? "produto deixou" : "produtos deixaram"} de tê-la.` : "Categoria apagada.";
  });
}
