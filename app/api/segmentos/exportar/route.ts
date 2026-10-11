import { requireAdminApi } from "@/lib/auth/admin";
import { query } from "@/lib/db";
import { hit } from "@/lib/rate-limit";
import { csvDoSegmento } from "@/lib/segments/exportar";
import { SEGMENTOS, classificar, ehSegmento } from "@/lib/segments/regras";
import { clientesAgregadas } from "@/lib/segments/repo";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Baixa o segmento em CSV para campanhas. Dados pessoais (nome, e-mail, telefone, cidade) só entram com `?contatos=1`, apenas de quem aceita
 * receber contato, e o pedido fica no Histórico (só o segmento e a contagem). Nunca CPF. Até 20 por hora.
 */
export async function GET(req: Request) {
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  const params = new URL(req.url).searchParams;
  const segmento = params.get("segmento");
  if (!ehSegmento(segmento)) return Response.json({ error: "Segmento inválido." }, { status: 400 });
  const contatos = params.get("contatos") === "1";
  if ((await hit({ query }, `segmentos-exportar:${admin.email}`, 3600)) > 20) return Response.json({ error: "Muitas exportações na última hora. Tente de novo daqui a pouco." }, { status: 429 });
  try {
    const por = classificar(await clientesAgregadas({ query }, store.id));
    const r = csvDoSegmento(segmento, por[segmento], { contatos });
    await query(`INSERT INTO audit_log (store_id, actor_email, acao, entidade, depois) VALUES ($1::uuid, $2, 'segmentos.exportar', 'loja', $3::jsonb)`, [store.id, admin.email, JSON.stringify({ segmento, linhas: r.linhas, contatos })]);
    const dia = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
    return new Response(r.conteudo, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="segmento-${segmento}-${dia}${contatos ? "-com-contatos" : ""}.csv"`,
        "cache-control": "no-store",
        ...(r.truncado ? { "x-truncado": "1" } : {}),
      },
    });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "segmentos.exportar.failed", segmento: SEGMENTOS[segmento].rotulo, message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Não foi possível gerar o arquivo agora." }, { status: 500 });
  }
}
