import { requireAdminApi } from "@/lib/auth/admin";
import { isSameOrigin } from "@/lib/security";
import { query } from "@/lib/db";
import { republicarComEstoqueAgora } from "@/lib/automations/in-stock";
import { NuvemshopError, getProduct, updateProduct } from "@/lib/nuvemshop";
import { clientForStore, getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Publica de novo, agora, os produtos que a regra "sem estoque" despublicou e que voltaram a ter estoque (confere cada um na loja antes). Retomável. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });

  const body = (await request.json().catch(() => ({}))) as { ignorar?: unknown };
  const ignorar = Array.isArray(body.ignorar) ? body.ignorar.filter((s): s is string => typeof s === "string" && /^\d+$/.test(s)).slice(0, 2000) : [];
  try {
    const client = await clientForStore(store);
    const r = await republicarComEstoqueAgora(
      { query },
      { getProduct: (id) => getProduct(client, id), setPublished: (id, published) => updateProduct(client, id, { published }) },
      { storeId: store.id, ator: admin.email, budgetMs: 25_000, ignorar },
    );
    return Response.json(r);
  } catch (err) {
    if (err instanceof NuvemshopError) return Response.json({ error: err.userMessage }, { status: 502 });
    console.error(JSON.stringify({ level: "error", event: "automacao.republicar.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Falha inesperada ao publicar." }, { status: 500 });
  }
}
