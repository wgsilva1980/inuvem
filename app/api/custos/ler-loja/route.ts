import { requireAdminApi } from "@/lib/auth/admin";
import { lerCustosDaLoja } from "@/lib/costs/repo";
import { query } from "@/lib/db";
import { isSameOrigin } from "@/lib/security";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";

/** Copia para o painel os custos que a loja já guarda nas variações (só em produtos sem custo no painel). Lê do espelho, sem chamar a loja. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  const n = await lerCustosDaLoja({ query }, store.id, admin.email);
  await query(`INSERT INTO audit_log (store_id, actor_email, acao, entidade, depois, sucesso) VALUES ($1::uuid, $2, 'custo.ler_loja', 'produto', $3::jsonb, true)`, [store.id, admin.email, JSON.stringify({ produtos: n })]);
  return Response.json({ produtos: n });
}
