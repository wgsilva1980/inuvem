import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/admin";
import { CarrinhoNaoEncontradoError, prepararMensagem } from "@/lib/carts/service";
import { query } from "@/lib/db";
import { RevisaoConfigError } from "@/lib/images/review";
import { NuvemshopError } from "@/lib/nuvemshop";
import { isSameOrigin } from "@/lib/security";
import { clientForStore, getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  id: z.number().int().positive(),
  cupom: z.object({ percent: z.number().min(1).max(50), dias: z.number().int().min(1).max(30) }).nullable().optional(),
});

/** Escreve a mensagem de recuperação de um carrinho (e cria o cupom de cortesia, se pedido). Não envia nada à cliente. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Dados inválidos. O cupom precisa ter de 1% a 50% e de 1 a 30 dias." }, { status: 400 });
  try {
    const r = await prepararMensagem({ query }, await clientForStore(store), { storeId: store.id, actor: admin.email, id: parsed.data.id, cupom: parsed.data.cupom ?? null });
    return Response.json(r);
  } catch (err) {
    if (err instanceof CarrinhoNaoEncontradoError) return Response.json({ error: err.message }, { status: 404 });
    if (err instanceof RevisaoConfigError) return Response.json({ error: err.message }, { status: 409 });
    if (err instanceof NuvemshopError) return Response.json({ error: err.userMessage }, { status: 502 });
    console.error(JSON.stringify({ level: "error", event: "carrinho.mensagem.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Falha inesperada ao preparar a mensagem." }, { status: 500 });
  }
}
