import { requireAdminApi } from "@/lib/auth/admin";
import { isSameOrigin } from "@/lib/security";
import { query } from "@/lib/db";
import { aplicarSeoPendentes, contarParaAplicar } from "@/lib/seo/repo";
import { getProduct, NuvemshopError, updateProduct } from "@/lib/nuvemshop";
import { clientForStore, getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Envia à loja as sugestões de SEO ainda não aplicadas (`modo`: "vazios" ou "todos"). Retomável; cada produto vai para o Histórico. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });

  const body = (await request.json().catch(() => ({}))) as { modo?: unknown; ignorar?: unknown };
  const modo = body.modo === "todos" ? "todos" : "vazios";
  const ignorar = Array.isArray(body.ignorar) ? body.ignorar.filter((s): s is string => typeof s === "string" && /^\d+$/.test(s)).slice(0, 2000) : [];
  try {
    const client = await clientForStore(store);
    const db = { query };
    const r = await aplicarSeoPendentes(
      db,
      { get: (id) => getProduct(client, id), put: (id, input) => updateProduct(client, id, input) },
      { storeId: store.id, actor: admin.email, budgetMs: 25_000, modo, ignorar },
    );
    return Response.json({ ...r, ...(await contarParaAplicar(db, store.id)) });
  } catch (err) {
    if (err instanceof NuvemshopError) return Response.json({ error: err.userMessage }, { status: 502 });
    console.error(JSON.stringify({ level: "error", event: "seo.apply.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Falha inesperada ao enviar o SEO." }, { status: 500 });
  }
}
