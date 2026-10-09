"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/admin";
import { query } from "@/lib/db";
import { NuvemshopError } from "@/lib/nuvemshop";
import { SeoItemError, aplicarSeoItem, type TipoItem } from "@/lib/seo/item";
import { apisDoCliente } from "@/lib/seo/item-service";
import { clientForStore, getActiveStore } from "@/lib/stores";

export interface SeoItemState {
  ok?: boolean;
  message?: string;
}

/** Grava o título e a descrição de SEO (editados ou não) de uma categoria ou página. */
export async function aplicarSeoItemAction(tipo: TipoItem, itemId: number, _prev: SeoItemState | null, formData: FormData): Promise<SeoItemState> {
  const admin = await requireAdmin();
  if ((tipo !== "categoria" && tipo !== "pagina") || !Number.isInteger(itemId) || itemId <= 0) return { message: "Item inválido." };
  const store = await getActiveStore();
  if (!store) return { message: "Nenhuma loja conectada." };
  try {
    const r = await aplicarSeoItem({ query }, apisDoCliente(await clientForStore(store)), {
      storeId: store.id,
      actor: admin.email,
      tipo,
      id: itemId,
      titulo: String(formData.get("titulo") ?? ""),
      descricao: String(formData.get("descricao") ?? ""),
      editado: formData.get("editado") === "1",
    });
    revalidatePath(tipo === "categoria" ? "/seo/categorias" : "/seo/paginas");
    return { ok: true, message: r.changed ? "SEO gravado na loja." : "Já estava assim na loja." };
  } catch (err) {
    if (err instanceof SeoItemError) return { message: err.message };
    if (err instanceof NuvemshopError) return { message: err.userMessage };
    console.error(JSON.stringify({ level: "error", event: "seo.item.apply.single.failed", message: err instanceof Error ? err.message : String(err) }));
    return { message: "Falha inesperada. Tente novamente." };
  }
}
