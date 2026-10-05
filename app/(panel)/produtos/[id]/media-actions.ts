"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/admin";
import {
  ProductMissingError,
  moveImage,
  moveImageTo,
  removeImage,
  safeFilename,
  uploadImage,
  sniffImageType,
  validateImageUpload,
  type ImageApi,
} from "@/lib/catalog/images";
import { DuplicateVariantError, InvalidVariantImageError, InvalidVariantValuesError, VariantConflictError, VariantNotFoundError } from "@/lib/catalog/update-variant";
import { query } from "@/lib/db";
import {
  NuvemshopError,
  createImage,
  deleteImage,
  getProduct,
  updateImage,
} from "@/lib/nuvemshop";
import { clientForStore, getActiveStore } from "@/lib/stores";

export interface ActionState {
  ok?: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
}

const fail = (err: unknown, event: string): ActionState => {
  if (err instanceof InvalidVariantValuesError || err instanceof DuplicateVariantError) return { message: err.message };
  if (err instanceof VariantConflictError || err instanceof VariantNotFoundError || err instanceof InvalidVariantImageError || err instanceof ProductMissingError) {
    return { message: err.message };
  }
  if (err instanceof NuvemshopError) return { message: err.userMessage };
  console.error(JSON.stringify({ level: "error", event, message: err instanceof Error ? err.message : String(err) }));
  return { message: "Falha inesperada. Tente novamente." };
};

const validId = (n: number) => Number.isInteger(n) && n > 0;

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

export async function removeProductImage(productId: number, imageId: number): Promise<ActionState> {
  await requireAdmin(); // a autorização vem antes de qualquer leitura do corpo ou validação
  if (!validId(imageId)) return { message: "Imagem inválida." };
  return withImages(productId, async ({ storeId, actor, api }) => {
    await removeImage({ query }, api, { storeId, actor, productId, imageId });
    return { ok: true, message: "Imagem removida." } satisfies ActionState;
  });
}

export async function moveProductImage(productId: number, imageId: number, direction: -1 | 1): Promise<ActionState> {
  await requireAdmin(); // a autorização vem antes de qualquer leitura do corpo ou validação
  if (!validId(imageId) || (direction !== -1 && direction !== 1)) return { message: "Imagem inválida." };
  return withImages(productId, async ({ storeId, actor, api }) => {
    const moved = await moveImage({ query }, api, { storeId, actor, productId, imageId, direction });
    return { ok: true, message: moved ? "Ordem atualizada." : "A imagem já está na ponta." } satisfies ActionState;
  });
}

/** Upload de arquivo (já reduzido no navegador quando grande). Valida tipo e tamanho de novo aqui: o navegador não é confiável. */
export async function uploadProductImage(productId: number, formData: FormData): Promise<ActionState> {
  await requireAdmin(); // a autorização vem antes de qualquer leitura do corpo ou validação
  const file = formData.get("file");
  if (!(file instanceof File)) return { message: "Escolha um arquivo de imagem." };
  const problem = validateImageUpload(file);
  if (problem) return { message: problem };
  const bytes = Buffer.from(await file.arrayBuffer());
  const real = sniffImageType(bytes);
  if (!real) return { message: "O conteúdo do arquivo não é uma imagem JPEG, PNG, WEBP ou GIF." };
  return withImages(productId, async ({ storeId, actor, api }) => {
    await uploadImage({ query }, api, { storeId, actor, productId, filename: safeFilename(file.name, real), bytes });
    return { ok: true, message: "Imagem enviada à Nuvemshop." } satisfies ActionState;
  });
}

export async function setMainProductImage(productId: number, imageId: number): Promise<ActionState> {
  await requireAdmin(); // a autorização vem antes de qualquer leitura do corpo ou validação
  if (!validId(imageId)) return { message: "Imagem inválida." };
  return withImages(productId, async ({ storeId, actor, api }) => {
    const moved = await moveImageTo({ query }, api, { storeId, actor, productId, imageId, toIndex: 0 });
    return { ok: true, message: moved ? "Imagem principal atualizada." : "Esta já é a imagem principal." } satisfies ActionState;
  });
}
