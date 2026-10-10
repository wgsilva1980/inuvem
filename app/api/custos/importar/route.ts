import { requireAdminApi } from "@/lib/auth/admin";
import { importarCustos } from "@/lib/costs/importar";
import { MAX_BYTES, lerPlanilha } from "@/lib/costs/planilha";
import { query } from "@/lib/db";
import { isSameOrigin } from "@/lib/security";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Importa custos de uma planilha .xlsx ou .csv (colunas ID ou SKU, e Custo). Linha com custo vazio é pulada; nada é apagado. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  const form = await request.formData().catch(() => null);
  const arquivo = form?.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) return Response.json({ error: "Escolha uma planilha." }, { status: 400 });
  if (arquivo.size > MAX_BYTES) return Response.json({ error: "A planilha passa de 2 MB." }, { status: 400 });
  const lida = await lerPlanilha(Buffer.from(await arquivo.arrayBuffer()), arquivo.name);
  if (lida.erro) return Response.json({ error: lida.erro }, { status: 400 });
  const r = await importarCustos({ query }, { storeId: store.id, actor: admin.email, linhas: lida.linhas });
  await query(`INSERT INTO audit_log (store_id, actor_email, acao, entidade, depois, sucesso) VALUES ($1::uuid, $2, 'custo.importar', 'produto', $3::jsonb, true)`, [
    store.id,
    admin.email,
    JSON.stringify({ linhas: lida.linhas.length, atualizados: r.atualizados, ignoradas: r.totalIgnoradas }),
  ]);
  return Response.json(r);
}
