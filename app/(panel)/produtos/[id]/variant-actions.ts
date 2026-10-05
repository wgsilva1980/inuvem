"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/admin";
import {
  AttributesConflictError,
  InvalidAttributesError,
  LastVariantError,
  createNewVariant,
  deleteProductVariant,
  type ManageApi,
} from "@/lib/catalog/manage-variants";
import { ProductMissingError } from "@/lib/catalog/images";
import { DuplicateVariantError, InvalidVariantValuesError, VariantNotFoundError } from "@/lib/catalog/update-variant";
import { formValues, variantEditSchema } from "@/lib/catalog/variants";
import { query } from "@/lib/db";
import { NuvemshopError, createVariant, deleteVariant, getProduct, updateProduct } from "@/lib/nuvemshop";
import { clientForStore, getActiveStore } from "@/lib/stores";

export interface ManageState {
  ok?: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
}

const KNOWN = [
  InvalidVariantValuesError,
  DuplicateVariantError,
  VariantNotFoundError,
  ProductMissingError,
  LastVariantError,
  InvalidAttributesError,
  AttributesConflictError,
];

const fail = (err: unknown, event: string): ManageState => {
  if (KNOWN.some((k) => err instanceof k)) return { message: (err as Error).message };
  if (err instanceof NuvemshopError) return { message: err.userMessage };
  console.error(JSON.stringify({ level: "error", event, message: err instanceof Error ? err.message : String(err) }));
  return { message: "Falha inesperada. Tente novamente." };
};

const validId = (n: number) => Number.isInteger(n) && n > 0;

async function withManage<T>(
  productId: number,
  event: string,
  fn: (ctx: { storeId: string; actor: string; api: ManageApi }) => Promise<T>,
): Promise<T | ManageState> {
  const admin = await requireAdmin(); // a autorização vem antes de qualquer leitura do corpo ou validação
  if (!validId(productId)) return { message: "Produto inválido." };
  const store = await getActiveStore();
  if (!store) return { message: "Nenhuma loja conectada." };
  try {
    const client = await clientForStore(store);
    const api: ManageApi = {
      getProduct: (pid) => getProduct(client, pid),
      createVariant: (pid, input) => createVariant(client, pid, input),
      deleteVariant: (pid, vid) => deleteVariant(client, pid, vid),
      updateProduct: (pid, input) => updateProduct(client, pid, input),
    };
    const result = await fn({ storeId: store.id, actor: admin.email, api });
    revalidatePath(`/produtos/${productId}`);
    revalidatePath("/produtos");
    return result;
  } catch (err) {
    revalidatePath(`/produtos/${productId}`); // a loja pode ter mudado mesmo com erro
    return fail(err, event);
  }
}

/** Cria uma variante nova (um valor por propriedade, mais preço, estoque, SKU e peso). */
export async function createProductVariant(productId: number, _prev: ManageState | null, formData: FormData): Promise<ManageState> {
  await requireAdmin();
  const parsed = variantEditSchema.safeParse({
    sku: formData.get("sku") ?? "",
    price: formData.get("price") ?? "",
    promotional_price: formData.get("promotional_price") ?? "",
    stock_management: formData.get("stock_management") === "on",
    stock: formData.get("stock") ?? "",
    image_id: "",
    weight: formData.get("weight") ?? "",
    depth: formData.get("depth") ?? "",
    width: formData.get("width") ?? "",
    height: formData.get("height") ?? "",
    mpn: formData.get("mpn") ?? "",
    age_group: formData.get("age_group") ?? "",
    gender: formData.get("gender") ?? "",
    values: formValues(formData) ?? [],
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] === "values" ? `value_${String(issue.path[1] ?? 0)}` : String(issue.path[0]);
      fieldErrors[key] ??= issue.message;
    }
    return { message: "Corrija os campos destacados.", fieldErrors };
  }
  const v = parsed.data;
  const result = await withManage(productId, "variant.create.failed", async ({ storeId, actor, api }) => {
    await createNewVariant({ query }, api, {
      storeId,
      actor,
      productId,
      variant: { sku: v.sku, price: v.price, promotional_price: v.promotional_price, stock_management: v.stock_management, stock: v.stock, weight: v.weight ?? null, depth: v.depth ?? null, width: v.width ?? null, height: v.height ?? null, mpn: v.mpn ?? null, age_group: v.age_group ?? null, gender: v.gender ?? null, values: v.values ?? [] },
    });
    return { ok: true, message: "Variante criada na Nuvemshop." } satisfies ManageState;
  });
  return result;
}

export async function deleteVariantAction(productId: number, variantId: number): Promise<ManageState> {
  await requireAdmin();
  if (!validId(variantId)) return { message: "Variante inválida." };
  return withManage(productId, "variant.delete.failed", async ({ storeId, actor, api }) => {
    await deleteProductVariant({ query }, api, { storeId, actor, productId, variantId });
    return { ok: true, message: "Variante excluída da Nuvemshop." } satisfies ManageState;
  });
}
