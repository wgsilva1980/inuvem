import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/admin";
import { emitirCashback } from "@/lib/cashback/service";
import { MAX_POR_CHAMADA } from "@/lib/cashback/rules";
import { query } from "@/lib/db";
import { isSameOrigin } from "@/lib/security";
import { clientForStore, getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({ ids: z.array(z.string().regex(/^\d{1,15}$/)).min(1).max(MAX_POR_CHAMADA) });

/** Cria os cupons de cashback dos pedidos escolhidos (até 5 por chamada; a tela repete). Tudo é reavaliado no servidor. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Escolha de 1 a 5 pedidos." }, { status: 400 });
  try {
    return Response.json({ resultados: await emitirCashback({ query }, await clientForStore(store), { storeId: store.id, actor: admin.email, ids: parsed.data.ids }) });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "cashback.emitir.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Falha inesperada ao emitir os cupons." }, { status: 500 });
  }
}
