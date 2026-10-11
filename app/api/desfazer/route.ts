import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/admin";
import { query } from "@/lib/db";
import { updateCategory as apiUpdateCategory, getCategory, getProduct, getVariant, NuvemshopError, createCategory as apiCreateCategory, deleteCategory as apiDeleteCategory, updateProduct as apiUpdateProduct, updateVariant as apiUpdateVariant } from "@/lib/nuvemshop";
import { hit } from "@/lib/rate-limit";
import { isSameOrigin } from "@/lib/security";
import { clientForStore, getActiveStore } from "@/lib/stores";
import { CategoryRuleError } from "@/lib/categories/manage";
import { ProductConflictError, ProductNotFoundError } from "@/lib/catalog/update";
import { VariantConflictError, VariantNotFoundError } from "@/lib/catalog/update-variant";
import { DesfazerError, desfazerEvento } from "@/lib/undo/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({ id: z.string().regex(/^\d{1,15}$/) });

/** Desfaz uma alteração do Histórico (produto, variação ou categoria), devolvendo os campos ao valor de antes. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Registro inválido." }, { status: 400 });
  if ((await hit({ query }, `desfazer:${admin.email}`, 3600)) > 60) return Response.json({ error: "Muitas reversões na última hora. Tente de novo daqui a pouco." }, { status: 429 });
  try {
    const client = await clientForStore(store);
    const r = await desfazerEvento(
      { query },
      {
        produto: { get: (id) => getProduct(client, id), put: (id, input) => apiUpdateProduct(client, id, input) },
        variante: { get: (pid, vid) => getVariant(client, pid, vid), put: (pid, vid, input) => apiUpdateVariant(client, pid, vid, input) },
        categoria: { get: (id) => getCategory(client, id), create: (input) => apiCreateCategory(client, input), update: (id, input) => apiUpdateCategory(client, id, input), remove: (id) => apiDeleteCategory(client, id) },
      },
      { storeId: store.id, actor: admin.email, id: parsed.data.id },
    );
    return Response.json({ ok: true, nome: r.nome });
  } catch (err) {
    if (err instanceof DesfazerError || err instanceof CategoryRuleError || err instanceof ProductConflictError || err instanceof ProductNotFoundError || err instanceof VariantConflictError || err instanceof VariantNotFoundError) {
      return Response.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof NuvemshopError) return Response.json({ error: err.userMessage }, { status: 502 });
    console.error(JSON.stringify({ level: "error", event: "desfazer.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Falha inesperada ao desfazer." }, { status: 500 });
  }
}
