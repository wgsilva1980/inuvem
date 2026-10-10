import { requireAdminApi } from "@/lib/auth/admin";
import { query } from "@/lib/db";
import { executarDiagnostico } from "@/lib/diagnostico/executar";
import { hit } from "@/lib/rate-limit";
import { isSameOrigin } from "@/lib/security";
import { clientForStore, getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LIMITE_POR_HORA = 20;

/** Roda as leituras de teste na API da Nuvemshop. Só leitura (GET): nada é alterado na loja. A resposta traz nomes de campos, nunca valores. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  if ((await hit({ query }, `diagnostico:${admin.email}`, 3600)) > LIMITE_POR_HORA) return Response.json({ error: "Muitos testes na última hora. Tente de novo daqui a pouco." }, { status: 429 });
  try {
    const d = await executarDiagnostico(await clientForStore(store));
    await query(`INSERT INTO audit_log (store_id, actor_email, acao, entidade, depois, sucesso) VALUES ($1::uuid, $2, 'diagnostico.api', 'loja', $3::jsonb, true)`, [
      store.id,
      admin.email,
      JSON.stringify({ resumo: Object.fromEntries(d.sondas.map((s) => [s.id, s.status])), webhooks: d.webhooks.status }),
    ]);
    return Response.json(d);
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "diagnostico.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Falha inesperada ao rodar o diagnóstico." }, { status: 500 });
  }
}
