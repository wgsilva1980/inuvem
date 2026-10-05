import { requireAdminApi } from "@/lib/auth/admin";
import { isSameOrigin } from "@/lib/security";
import { query } from "@/lib/db";
import { aplicarAltPendentes } from "@/lib/images/review";
import { altApiDoCliente } from "@/lib/images/review-api";
import { NuvemshopError } from "@/lib/nuvemshop";
import { clientForStore, getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Envia à loja os textos alternativos sugeridos (só onde a loja está sem texto, ou o texto foi editado). Retomável. */
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
    return Response.json(await aplicarAltPendentes({ query }, altApiDoCliente(client), { storeId: store.id, actor: admin.email, budgetMs: 25_000, ignorar }));
  } catch (err) {
    if (err instanceof NuvemshopError) return Response.json({ error: err.userMessage }, { status: 502 });
    console.error(JSON.stringify({ level: "error", event: "image.alt.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Falha inesperada ao enviar os textos." }, { status: 500 });
  }
}
