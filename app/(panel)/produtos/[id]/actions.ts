"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/admin";
import { prepareDescription } from "@/lib/catalog/description";
import { productEditSchema } from "@/lib/catalog/edit";
import { getProductDetail } from "@/lib/catalog/query";
import { ProductConflictError, ProductNotFoundError, updateProduct } from "@/lib/catalog/update";
import { deleteProduct } from "@/lib/catalog/delete";
import { ProductMissingError } from "@/lib/catalog/images";
import { AttributesConflictError, InvalidAttributesError, renameAttributes, type ManageApi } from "@/lib/catalog/manage-variants";
import { DuplicateVariantError, InvalidVariantImageError, InvalidVariantValuesError, VariantConflictError, VariantNotFoundError, updateVariant } from "@/lib/catalog/update-variant";
import { formVariantIds, variantEditSchema, variantFormInput } from "@/lib/catalog/variants";
import { query } from "@/lib/db";
import { NuvemshopError, getProduct, getVariant, updateProduct as apiUpdateProduct, updateVariant as apiUpdateVariant, deleteProduct as apiDeleteProduct } from "@/lib/nuvemshop";
import { redirect } from "next/navigation";
import { clientForStore, getActiveStore } from "@/lib/stores";

export interface SaveState {
  ok?: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
}

const KNOWN = [
  ProductConflictError,
  ProductNotFoundError,
  ProductMissingError,
  VariantConflictError,
  VariantNotFoundError,
  InvalidVariantValuesError,
  DuplicateVariantError,
  InvalidVariantImageError,
  InvalidAttributesError,
  AttributesConflictError,
];

function describe(err: unknown, event: string): string {
  if (KNOWN.some((k) => err instanceof k)) return (err as Error).message;
  if (err instanceof NuvemshopError) return err.userMessage;
  console.error(JSON.stringify({ level: "error", event, message: err instanceof Error ? err.message : String(err) }));
  return "falha inesperada.";
}

/** Salva de uma vez tudo o que a página tem: dados do produto, nomes das propriedades e as variantes alteradas. */
export async function saveProduct(productId: number, _prev: SaveState | null, formData: FormData): Promise<SaveState> {
  const admin = await requireAdmin();
  if (!Number.isInteger(productId) || productId <= 0) return { message: "Produto inválido." };

  const fieldErrors: Record<string, string> = {};
  const parsed = productEditSchema.safeParse({
    name: formData.get("name") ?? "",
    description: formData.get("description") ?? "",
    tags: formData.get("tags") ?? "",
    published: formData.get("published") === "on",
    seo_title: formData.get("seo_title") ?? "",
    seo_description: formData.get("seo_description") ?? "",
    categories: formData.getAll("categories").map(Number).filter((n) => Number.isInteger(n) && n > 0),
  });
  if (!parsed.success) for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;

  const variants: { id: number; after: NonNullable<ReturnType<typeof variantEditSchema.parse>> }[] = [];
  for (const id of formVariantIds(formData)) {
    const v = variantEditSchema.safeParse(variantFormInput(formData, id));
    if (!v.success) {
      for (const issue of v.error.issues) {
        const key = issue.path[0] === "values" ? `value_${String(issue.path[1] ?? 0)}` : String(issue.path[0]);
        fieldErrors[`v${id}_${key}`] ??= issue.message;
      }
    } else variants.push({ id, after: v.data });
  }
  if (Object.keys(fieldErrors).length > 0 || !parsed.success) return { message: "Corrija os campos destacados. Nada foi salvo.", fieldErrors };

  const nameKeys = [...formData.keys()].filter((k) => /^name_\d{1,2}$/.test(k)).sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)));
  const attributeNames = nameKeys.map((k) => String(formData.get(k) ?? ""));

  const store = await getActiveStore();
  if (!store) return { message: "Nenhuma loja conectada." };

  let changes = 0;
  const problems: string[] = [];
  try {
    const client = await clientForStore(store);

    try {
      // Só limpa o HTML se a descrição foi editada; sem edição, o original da loja segue intacto.
      const current = await getProductDetail({ query }, store.id, productId);
      const after = { ...parsed.data, description: prepareDescription(parsed.data.description, current?.description ?? null) };
      const result = await updateProduct(
        { query },
        { get: (id) => getProduct(client, id), put: (id, input) => apiUpdateProduct(client, id, input) },
        { storeId: store.id, actor: admin.email, productId, after },
      );
      if (result.changed) changes++;
    } catch (err) {
      problems.push(`Dados do produto: ${describe(err, "product.update.failed")}`);
    }

    if (attributeNames.length > 0) {
      try {
        const api: ManageApi = {
          getProduct: (pid) => getProduct(client, pid),
          createVariant: () => Promise.reject(new Error("não usado")),
          deleteVariant: () => Promise.reject(new Error("não usado")),
          updateProduct: (pid, input) => apiUpdateProduct(client, pid, input),
        };
        const r = await renameAttributes({ query }, api, { storeId: store.id, actor: admin.email, productId, names: attributeNames });
        if (r.changed) changes++;
      } catch (err) {
        problems.push(`Propriedades: ${describe(err, "attributes.update.failed")}`);
      }
    }

    for (const { id, after } of variants) {
      try {
        const r = await updateVariant(
          { query },
          { get: (pid, vid) => getVariant(client, pid, vid), put: (pid, vid, input) => apiUpdateVariant(client, pid, vid, input) },
          { storeId: store.id, actor: admin.email, productId, variantId: id, after },
        );
        if (r.changed) changes++;
      } catch (err) {
        problems.push(`Variante ${variantLabel(formData, id)}: ${describe(err, "variant.update.failed")}`);
      }
    }
  } catch (err) {
    problems.push(describe(err, "product.update.failed"));
  }

  revalidatePath("/produtos");
  revalidatePath(`/produtos/${productId}`);
  if (problems.length === 0) return { ok: true, message: changes > 0 ? "Alterações salvas na Nuvemshop." : "Nada foi alterado." };
  const done = changes > 0 ? `${changes} parte(s) salva(s). ` : "";
  return { message: `${done}Não foi possível salvar: ${problems.join(" · ")}` };
}

function variantLabel(formData: FormData, id: number): string {
  const vals = [...formData.keys()]
    .filter((k) => k.startsWith(`v${id}_value_`))
    .sort()
    .map((k) => String(formData.get(k) ?? "").trim())
    .filter(Boolean);
  return vals.length > 0 ? `“${vals.join(" / ")}”` : `${id}`;
}

/** Exclui o produto na Nuvemshop (irreversível). Exige que o nome seja digitado igual, como confirmação. */
export async function deleteProductAction(productId: number, _prev: SaveState | null, formData: FormData): Promise<SaveState> {
  const admin = await requireAdmin();
  if (!Number.isInteger(productId) || productId <= 0) return { message: "Produto inválido." };
  const store = await getActiveStore();
  if (!store) return { message: "Nenhuma loja conectada." };

  const current = await getProductDetail({ query }, store.id, productId);
  if (!current) return { message: "Produto não encontrado no espelho. Sincronize o catálogo e tente de novo." };
  const typed = String(formData.get("confirm_name") ?? "").trim();
  if (typed !== current.name.trim()) return { message: "Digite o nome do produto exatamente como aparece acima para confirmar." };

  try {
    const client = await clientForStore(store);
    await deleteProduct({ query }, { deleteProduct: (id) => apiDeleteProduct(client, id) }, { storeId: store.id, actor: admin.email, productId });
  } catch (err) {
    return { message: `Não foi possível excluir: ${describe(err, "product.delete.failed")}` };
  }
  revalidatePath("/produtos");
  redirect("/produtos?excluido=1");
}
