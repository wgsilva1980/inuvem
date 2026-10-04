"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/admin";
import { ProductMissingError, addImage, imageUrlSchema, moveImage, removeImage, type ImageApi } from "@/lib/catalog/images";
import { VariantConflictError, VariantNotFoundError, updateVariant } from "@/lib/catalog/update-variant";
import { variantEditSchema } from "@/lib/catalog/variants";
import { query } from "@/lib/db";
import {
  NuvemshopError,
  createImage,
  deleteImage,
  getProduct,
  getVariant,
  updateImage,
  updateVariant as apiUpdateVariant,
} from "@/lib/nuvemshop";
import { clientForStore, getActiveStore } from "@/lib/stores";

export interface ActionState {
  ok?: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
}

const fail = (err: unknown, event: string): ActionState => {
  if (err instanceof VariantConflictError || err instanceof VariantNotFoundError || err instanceof ProductMissingError) return { message: err.message };
  if (err instanceof NuvemshopError) return { message: err.userMessage };
  console.error(JSON.stringify({ level: "error", event, message: err instanceof Error ? err.message : String(err) }));
  return { message: "Falha inesperada. Tente novamente." };
};

const validId = (n: number) => Number.isInteger(n) && n > 0;

export async function saveVariant(productId: number, variantId: number, _prev: ActionState | null, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  if (!validId(productId) || !validId(variantId)) return { message: "Variante inválida." };

  const parsed = variantEditSchema.safeParse({
    sku: formData.get("sku") ?? "",
    price: formData.get("price") ?? "",
    promotional_price: formData.get("promotional_price") ?? "",
    stock_management: formData.get("stock_management") === "on",
    stock: formData.get("stock") ?? "",
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
    const result = await updateVariant(
      { query },
      {
        get: (pid, vid) => getVariant(client, pid, vid),
        put: (pid, vid, input) => apiUpdateVariant(client, pid, vid, input),
      },
      { storeId: store.id, actor: admin.email, productId, variantId, after: parsed.data },
    );
    revalidatePath(`/produtos/${productId}`);
    revalidatePath("/produtos");
    return { ok: true, message: result.changed ? "Variante atualizada na Nuvemshop." : "Nada foi alterado." };
  } catch (err) {
    if (err instanceof VariantConflictError) revalidatePath(`/produtos/${productId}`);
    return fail(err, "variant.update.failed");
  }
}

async function withImages<T>(productId: number, fn: (ctx: { storeId: string; actor: string; api: ImageApi }) => Promise<T>): Promise<T | ActionState> {
  const admin = await requireAdmin();
  if (!validId(productId)) return { message: "Produto inválido." };
  const store = await getActiveStore();
  if (!store) return { message: "Nenhuma loja conectada." };
  try {
    const client = await clientForStore(store);
    const api: ImageApi = {
      getProduct: (pid) => getProduct(client, pid),
      create: (pid, input) => createImage(client, pid, input),
      remove: (pid, iid) => deleteImage(client, pid, iid),
      setPosition: (pid, iid, position) => updateImage(client, pid, iid, { position }),
    };
    const result = await fn({ storeId: store.id, actor: admin.email, api });
    revalidatePath(`/produtos/${productId}`);
    revalidatePath("/produtos");
    return result;
  } catch (err) {
    revalidatePath(`/produtos/${productId}`); // a loja pode ter mudado mesmo com erro
    return fail(err, "image.operation.failed");
  }
}

export async function addProductImage(productId: number, _prev: ActionState | null, formData: FormData): Promise<ActionState> {
  const parsed = imageUrlSchema.safeParse(formData.get("src") ?? "");
  if (!parsed.success) return { message: parsed.error.issues[0]?.message ?? "URL inválida.", fieldErrors: { src: parsed.error.issues[0]?.message ?? "URL inválida." } };
  const r = await withImages(productId, async ({ storeId, actor, api }) => {
    await addImage({ query }, api, { storeId, actor, productId, src: parsed.data });
    return { ok: true, message: "Imagem enviada à Nuvemshop." } satisfies ActionState;
  });
  return r;
}

export async function removeProductImage(productId: number, imageId: number): Promise<ActionState> {
  if (!validId(imageId)) return { message: "Imagem inválida." };
  return withImages(productId, async ({ storeId, actor, api }) => {
    await removeImage({ query }, api, { storeId, actor, productId, imageId });
    return { ok: true, message: "Imagem removida." } satisfies ActionState;
  });
}

export async function moveProductImage(productId: number, imageId: number, direction: -1 | 1): Promise<ActionState> {
  if (!validId(imageId) || (direction !== -1 && direction !== 1)) return { message: "Imagem inválida." };
  return withImages(productId, async ({ storeId, actor, api }) => {
    const moved = await moveImage({ query }, api, { storeId, actor, productId, imageId, direction });
    return { ok: true, message: moved ? "Ordem atualizada." : "A imagem já está na ponta." } satisfies ActionState;
  });
}
