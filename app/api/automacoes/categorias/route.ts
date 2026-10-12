import { requireAdminApi } from "@/lib/auth/admin";
import { isSameOrigin } from "@/lib/security";
import { query } from "@/lib/db";
import { aplicarRegraCategorias } from "@/lib/automations/categorias";
import { NuvemshopError, getCategory, updateCategory } from "@/lib/nuvemshop";
import { clientForStore, getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Aplica agora a regra das categorias vazias (oculta as sem produto publicado e reexibe as que a regra ocultou e voltaram a ter produto), mesmo com a opção desligada. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  try {
    const client = await clientForStore(store);
    const r = await aplicarRegraCategorias(
      { query },
      { getCategory: (id) => getCategory(client, id), setVisibility: (id, visibility) => updateCategory(client, id, { visibility }) },
      { storeId: store.id, ator: admin.email, forcar: true },
    );
    return Response.json(r);
  } catch (err) {
    if (err instanceof NuvemshopError) return Response.json({ error: err.userMessage }, { status: 502 });
    console.error(JSON.stringify({ level: "error", event: "automacao.categorias.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Falha inesperada ao aplicar a regra das categorias." }, { status: 500 });
  }
}
