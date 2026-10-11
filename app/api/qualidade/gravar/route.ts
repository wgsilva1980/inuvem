import { requireAdminApi } from "@/lib/auth/admin";
import { gravarCorrecao, itemGravacaoSchema } from "@/lib/catalog/corrigir";
import { query } from "@/lib/db";
import { getProduct, updateProduct } from "@/lib/nuvemshop";
import { isSameOrigin } from "@/lib/security";
import { clientForStore, getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_ITENS = 10;

/** Grava na loja as correções que a pessoa aprovou (até 10 produtos por chamada). Cada produto vai para o Histórico e pode ser desfeito. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  const body = (await request.json().catch(() => null)) as { itens?: unknown } | null;
  if (!body || !Array.isArray(body.itens) || body.itens.length === 0 || body.itens.length > MAX_ITENS) return Response.json({ error: `Envie de 1 a ${MAX_ITENS} produtos.` }, { status: 400 });
  const itens = body.itens.map((i) => itemGravacaoSchema.safeParse(i));
  if (itens.some((i) => !i.success)) return Response.json({ error: "Dados inválidos." }, { status: 400 });
  const client = await clientForStore(store);
  const api = { get: (id: number) => getProduct(client, id), put: (id: number, input: Parameters<typeof updateProduct>[2]) => updateProduct(client, id, input) };
  const db = { query };
  const resultados = [];
  for (const i of itens) {
    if (!i.success) continue;
    resultados.push(await gravarCorrecao(db, api, { storeId: store.id, actor: admin.email, item: i.data }));
  }
  return Response.json({ resultados });
}
