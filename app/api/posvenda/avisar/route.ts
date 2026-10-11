import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/admin";
import { query } from "@/lib/db";
import { PosVendaErro, registrarAvisoPosVenda } from "@/lib/postsale/service";
import { isSameOrigin } from "@/lib/security";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ orderId: z.string().regex(/^\d{1,15}$/) });

/** Marca o pós-venda do pedido como feito (a cliente some da lista por 30 dias). */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Pedido inválido." }, { status: 400 });
  try {
    await registrarAvisoPosVenda({ query }, { storeId: store.id, actor: admin.email, orderId: parsed.data.orderId });
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof PosVendaErro) return Response.json({ error: err.message }, { status: 404 });
    console.error(JSON.stringify({ level: "error", event: "posvenda.avisar.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Falha inesperada." }, { status: 500 });
  }
}
