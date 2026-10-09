import { requireAdminApi } from "@/lib/auth/admin";
import { query } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { NuvemshopError } from "@/lib/nuvemshop";
import { avancarPromocao } from "@/lib/promotions/engine";
import { PromocaoError } from "@/lib/promotions/repo";
import { bulkApiDaLoja } from "@/lib/promotions/service";
import { isSameOrigin } from "@/lib/security";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Um passo da promoção: `{acao: "iniciar" | "encerrar"}` dispara "Iniciar agora" / "Encerrar agora"; sem ação, só continua o que está em andamento.
 * A tela repete a chamada até `done`.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Promoção inválida." }, { status: 400 });
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  const body = (await request.json().catch(() => ({}))) as { acao?: unknown };
  const acao = body.acao === "iniciar" || body.acao === "encerrar" ? body.acao : undefined;
  try {
    const r = await avancarPromocao({ query }, await bulkApiDaLoja(store), { storeId: store.id, actor: admin.email, id, acao, budgetMs: Math.min(getEnv().SYNC_TIME_BUDGET_MS, 30_000) });
    return Response.json(r);
  } catch (err) {
    if (err instanceof PromocaoError) return Response.json({ error: err.message }, { status: 409 });
    if (err instanceof NuvemshopError) return Response.json({ error: err.userMessage }, { status: 502 });
    console.error(JSON.stringify({ level: "error", event: "promocao.step_failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Falha inesperada ao processar a promoção." }, { status: 500 });
  }
}
