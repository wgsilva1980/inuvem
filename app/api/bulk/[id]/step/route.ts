import { requireAdminApi } from "@/lib/auth/admin";
import { isSameOrigin } from "@/lib/security";
import { getEnv } from "@/lib/env";
import { query } from "@/lib/db";
import { stepJob } from "@/lib/bulk/engine";
import { JobStateError, getJobCounts } from "@/lib/bulk/repo";
import { NuvemshopError, deleteProduct, getProduct, updateProduct, updateVariant } from "@/lib/nuvemshop";
import { clientForStore, getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Processa mais um pedaço do lote (a tela chama de novo até `done`). Retomável: o estado fica no banco. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Lote inválido." }, { status: 400 });

  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });

  try {
    const client = await clientForStore(store);
    const db = { query };
    const result = await stepJob(
      db,
      {
        getProduct: (pid) => getProduct(client, pid),
        updateProduct: (pid, input) => updateProduct(client, pid, input),
        deleteProduct: (pid) => deleteProduct(client, pid),
        updateVariant: (pid, vid, input) => updateVariant(client, pid, vid, input),
      },
      { storeId: store.id, actor: admin.email, jobId: id, budgetMs: Math.min(getEnv().SYNC_TIME_BUDGET_MS, 30_000) },
    );
    return Response.json({ ...result, counts: await getJobCounts(db, id) });
  } catch (err) {
    if (err instanceof JobStateError) return Response.json({ error: err.message }, { status: 404 });
    if (err instanceof NuvemshopError) return Response.json({ error: err.userMessage }, { status: 502 });
    console.error(JSON.stringify({ level: "error", event: "bulk.step.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Falha inesperada ao processar o lote." }, { status: 500 });
  }
}
