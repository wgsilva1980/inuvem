"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/admin";
import { productEditSchema } from "@/lib/catalog/edit";
import { ProductConflictError, ProductNotFoundError, updateProduct } from "@/lib/catalog/update";
import { query } from "@/lib/db";
import { NuvemshopError, getProduct, updateProduct as apiUpdateProduct } from "@/lib/nuvemshop";
import { clientForStore, getActiveStore } from "@/lib/stores";

export interface SaveState {
  ok?: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
}

export async function saveProduct(productId: number, _prev: SaveState | null, formData: FormData): Promise<SaveState> {
  const admin = await requireAdmin();
  if (!Number.isInteger(productId) || productId <= 0) return { message: "Produto inválido." };

  const parsed = productEditSchema.safeParse({
    name: formData.get("name") ?? "",
    description: formData.get("description") ?? "",
    tags: formData.get("tags") ?? "",
    published: formData.get("published") === "on",
    seo_title: formData.get("seo_title") ?? "",
    seo_description: formData.get("seo_description") ?? "",
    categories: formData.getAll("categories").map(Number).filter((n) => Number.isInteger(n) && n > 0),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { message: "Corrija os campos destacados.", fieldErrors };
  }

  const store = await getActiveStore();
  if (!store) return { message: "Nenhuma loja conectada." };

  try {
    const client = await clientForStore(store);
    const result = await updateProduct(
      { query },
      { get: (id) => getProduct(client, id), put: (id, input) => apiUpdateProduct(client, id, input) },
      { storeId: store.id, actor: admin.email, productId, after: parsed.data },
    );
    revalidatePath("/produtos");
    revalidatePath(`/produtos/${productId}`);
    return { ok: true, message: result.changed ? "Produto atualizado na Nuvemshop." : "Nada foi alterado." };
  } catch (err) {
    if (err instanceof ProductConflictError || err instanceof ProductNotFoundError) {
      revalidatePath(`/produtos/${productId}`);
      return { message: err.message };
    }
    if (err instanceof NuvemshopError) return { message: err.userMessage };
    console.error(JSON.stringify({ level: "error", event: "product.update.failed", message: err instanceof Error ? err.message : String(err) }));
    return { message: "Falha inesperada ao salvar o produto." };
  }
}
