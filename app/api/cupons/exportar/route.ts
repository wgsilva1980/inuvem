import { requireAdminApi } from "@/lib/auth/admin";
import { COLUNAS_CUPONS } from "@/lib/export/colunas";
import { gerarXlsx, respostaXlsx } from "@/lib/export/xlsx";
import { hojeEmBrasilia, situacaoDoCupom } from "@/lib/coupons/lote";
import { todosOsCupons } from "@/lib/coupons/service";
import { query } from "@/lib/db";
import { NuvemshopError } from "@/lib/nuvemshop";
import { clientForStore, getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Planilha dos cupons com os mesmos filtros da tela /cupons (busca, situação) ou só os de um prefixo (lote recém-criado). */
export async function GET(req: Request) {
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  const p = new URL(req.url).searchParams;
  const q = (p.get("q") ?? "").trim().toUpperCase().slice(0, 40);
  const prefixo = (p.get("prefixo") ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  const situacao = p.get("situacao") ?? "";
  try {
    const hoje = hojeEmBrasilia();
    const { itens } = await todosOsCupons(await clientForStore(store));
    const linhas = itens
      .filter((c) => (q ? c.code.toUpperCase().includes(q) : true) && (prefixo ? c.code.toUpperCase().startsWith(prefixo) : true) && (situacao ? situacaoDoCupom(c, hoje) === situacao : true))
      .sort((a, b) => a.code.localeCompare(b.code));
    const buf = await gerarXlsx("Cupons", COLUNAS_CUPONS(hoje), linhas);
    await query(`INSERT INTO audit_log (store_id, actor_email, acao, entidade, depois) VALUES ($1::uuid, $2, 'cupom.exportar', 'cupom', $3::jsonb)`, [
      store.id,
      admin.email,
      JSON.stringify({ linhas: linhas.length, filtros: { busca: q ? "(busca)" : null, prefixo: prefixo || null, situacao: situacao || null } }),
    ]);
    return respostaXlsx(buf, prefixo ? `cupons-${prefixo.toLowerCase()}` : "cupons");
  } catch (err) {
    if (err instanceof NuvemshopError) return Response.json({ error: err.userMessage }, { status: 502 });
    throw err;
  }
}
