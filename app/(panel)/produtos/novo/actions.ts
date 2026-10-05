"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/admin";
import { InvalidNewProductError, createProduct } from "@/lib/catalog/create";
import { parseNewProductForm } from "@/lib/catalog/new-product-form";
import { query } from "@/lib/db";
import { NuvemshopError, createProduct as apiCreateProduct } from "@/lib/nuvemshop";
import { clientForStore, getActiveStore } from "@/lib/stores";

export interface NovoProdutoState {
  message?: string;
  fieldErrors?: Record<string, string>;
}

/** Cria o produto na Nuvemshop. Em caso de sucesso, vai para a tela do produto (onde se adicionam as fotos). */
export async function criarProduto(_prev: NovoProdutoState | null, formData: FormData): Promise<NovoProdutoState> {
  const admin = await requireAdmin(); // a autorização vem antes de qualquer leitura do corpo ou validação
  const parsed = parseNewProductForm(formData);
  if (!parsed.ok) return { message: parsed.message, fieldErrors: parsed.fieldErrors };

  const store = await getActiveStore();
  if (!store) return { message: "Nenhuma loja conectada." };

  let id: number;
  try {
    const client = await clientForStore(store);
    const r = await createProduct({ query }, { create: (input) => apiCreateProduct(client, input) }, { storeId: store.id, actor: admin.email, product: parsed.product, variants: parsed.variants });
    id = r.id;
  } catch (err) {
    if (err instanceof InvalidNewProductError) return { message: err.message };
    if (err instanceof NuvemshopError) return { message: err.userMessage };
    console.error(JSON.stringify({ level: "error", event: "product.create.failed", message: err instanceof Error ? err.message : String(err) }));
    return { message: "Falha inesperada ao criar o produto." };
  }
  revalidatePath("/produtos");
  redirect(`/produtos/${id}?criado=1`);
}
