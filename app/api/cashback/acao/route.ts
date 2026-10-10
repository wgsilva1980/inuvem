import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/admin";
import { CashbackNaoEncontradoError, cancelarCupom, marcarContatada } from "@/lib/cashback/service";
import { query } from "@/lib/db";
import { NuvemshopError } from "@/lib/nuvemshop";
import { isSameOrigin } from "@/lib/security";
import { clientForStore, getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({ orderId: z.string().regex(/^\d{1,15}$/), acao: z.enum(["contatada", "pendente", "cancelar"]) });

/** Marca a cliente como avisada (ou desmarca) ou cancela o cupom (desativa na loja; não apaga). */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Dados inválidos." }, { status: 400 });
  const { orderId, acao } = parsed.data;
  try {
    if (acao === "cancelar") await cancelarCupom({ query }, await clientForStore(store), { storeId: store.id, actor: admin.email, orderId });
    else if (!(await marcarContatada({ query }, { storeId: store.id, actor: admin.email, orderId, contatada: acao === "contatada" }))) throw new CashbackNaoEncontradoError("Cupom não encontrado.");
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof CashbackNaoEncontradoError) return Response.json({ error: err.message }, { status: 404 });
    if (err instanceof NuvemshopError) return Response.json({ error: err.userMessage }, { status: 502 });
    console.error(JSON.stringify({ level: "error", event: "cashback.acao.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Falha inesperada." }, { status: 500 });
  }
}
