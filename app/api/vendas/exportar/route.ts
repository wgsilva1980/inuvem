import { requireAdminApi } from "@/lib/auth/admin";
import { hojeEmBrasilia } from "@/lib/coupons/lote";
import { query } from "@/lib/db";
import { COLUNAS_VENDAS } from "@/lib/export/colunas";
import { gerarXlsx, respostaXlsx } from "@/lib/export/xlsx";
import { DIAS_PERIODO, maisVendidos, periodos } from "@/lib/orders/stats";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Planilha dos produtos vendidos no período (mesmo recorte da tela /vendas). Registra no Histórico só a contagem e o período. */
export async function GET(req: Request) {
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  const d = Number(new URL(req.url).searchParams.get("dias"));
  const dias = (DIAS_PERIODO as readonly number[]).includes(d) ? d : 30;
  const { atual } = periodos(hojeEmBrasilia(), dias);
  const linhas = await maisVendidos({ query }, store.id, atual, "unidades", 1000);
  const buf = await gerarXlsx("Produtos vendidos", COLUNAS_VENDAS, linhas);
  await query(`INSERT INTO audit_log (store_id, actor_email, acao, entidade, depois) VALUES ($1::uuid, $2, 'venda.exportar', 'venda', $3::jsonb)`, [
    store.id,
    admin.email,
    JSON.stringify({ linhas: linhas.length, dias, de: atual.de, ate: atual.ate }),
  ]);
  return respostaXlsx(buf, `vendas-${atual.de}-a-${atual.ate}`);
}
