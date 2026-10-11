import { requireAdminApi } from "@/lib/auth/admin";
import { montarBackup } from "@/lib/backup/montar";
import { query } from "@/lib/db";
import { hit } from "@/lib/rate-limit";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** A Vercel recusa respostas com mais de 4,5 MB; fica uma folga. */
export const LIMITE_BYTES = 4_200_000;

/**
 * Baixa o backup (.zip) do que o painel guarda da loja. Só lê o banco. Dados pessoais de clientes só entram com `?clientes=1` e isso fica registrado
 * no Histórico (sem nenhum dado, só a contagem). Até 10 por hora.
 */
export async function GET(req: Request) {
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  if ((await hit({ query }, `backup:${admin.email}`, 3600)) > 10) return Response.json({ error: "Muitos backups na última hora. Tente de novo daqui a pouco." }, { status: 429 });
  const incluirClientes = new URL(req.url).searchParams.get("clientes") === "1";
  try {
    const { zip, resumo, nomeSugerido } = await montarBackup({ query }, { storeId: store.id, nomeDaLoja: store.name ?? null, opcoes: { incluirClientes } });
    if (zip.length > LIMITE_BYTES) {
      return Response.json({ error: `O backup ficou com ${(zip.length / 1_048_576).toFixed(1)} MB, grande demais para baixar de uma vez (o limite é 4 MB).${incluirClientes ? " Gere de novo sem os clientes." : ""}` }, { status: 413 });
    }
    await query(`INSERT INTO audit_log (store_id, actor_email, acao, entidade, depois) VALUES ($1::uuid, $2, 'backup.gerar', 'loja', $3::jsonb)`, [store.id, admin.email, JSON.stringify({ ...resumo, clientesIncluidos: incluirClientes })]);
    return new Response(new Uint8Array(zip), { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${nomeSugerido}"`, "cache-control": "no-store" } });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "backup.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Não foi possível gerar o backup agora." }, { status: 500 });
  }
}
