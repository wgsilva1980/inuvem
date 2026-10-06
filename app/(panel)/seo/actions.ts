"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/admin";
import { ProductConflictError, ProductNotFoundError } from "@/lib/catalog/update";
import { query } from "@/lib/db";
import { NuvemshopError, getProduct, updateProduct } from "@/lib/nuvemshop";
import { SeoInvalidoError, aplicarSeo } from "@/lib/seo/repo";
import { clientForStore, getActiveStore } from "@/lib/stores";

export interface SeoState {
  ok?: boolean;
  message?: string;
}

/** Grava o título e a descrição de SEO (editados ou não) no produto. */
export async function aplicarSeoAction(productId: number, _prev: SeoState | null, formData: FormData): Promise<SeoState> {
  const admin = await requireAdmin();
  if (!Number.isInteger(productId) || productId <= 0) return { message: "Produto inválido." };
  const store = await getActiveStore();
  if (!store) return { message: "Nenhuma loja conectada." };
  try {
    const client = await clientForStore(store);
    const r = await aplicarSeo(
      { query },
      { get: (id) => getProduct(client, id), put: (id, input) => updateProduct(client, id, input) },
      {
        storeId: store.id,
        actor: admin.email,
        productId,
        titulo: String(formData.get("titulo") ?? ""),
        descricao: String(formData.get("descricao") ?? ""),
        editado: formData.get("editado") === "1",
      },
    );
    revalidatePath("/seo");
    return { ok: true, message: r.changed ? "SEO gravado na loja." : "Já estava assim na loja." };
  } catch (err) {
    if (err instanceof SeoInvalidoError || err instanceof ProductConflictError || err instanceof ProductNotFoundError) return { message: err.message };
    if (err instanceof NuvemshopError) return { message: err.userMessage };
    console.error(JSON.stringify({ level: "error", event: "seo.apply.single.failed", message: err instanceof Error ? err.message : String(err) }));
    return { message: "Falha inesperada. Tente novamente." };
  }
}
