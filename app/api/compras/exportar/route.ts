import { requireAdminApi } from "@/lib/auth/admin";
import { query } from "@/lib/db";
import { gerarXlsx, respostaXlsx } from "@/lib/export/xlsx";
import { COBERTURAS, COBERTURA_PADRAO, JANELAS, JANELA_PADRAO, PRAZOS, PRAZO_PADRAO, escolher } from "@/lib/purchasing/rules";
import { sugestoesDeCompra, type SugestaoCompra } from "@/lib/purchasing/sugestoes";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Planilha da lista de compras sugerida (mesmos parâmetros da tela /compras), para mandar ao fornecedor ou conferir. */
export async function GET(req: Request) {
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  const sp = new URL(req.url).searchParams;
  const args = { janela: escolher(JANELAS, sp.get("janela"), JANELA_PADRAO), prazo: escolher(PRAZOS, sp.get("prazo"), PRAZO_PADRAO), cobertura: escolher(COBERTURAS, sp.get("cobertura"), COBERTURA_PADRAO) };
  const linhas = await sugestoesDeCompra({ query }, store.id, args);
  const buf = await gerarXlsx<SugestaoCompra>("Lista de compras", [
    { titulo: "Produto", valor: (l) => l.produto, largura: 40 },
    { titulo: "Variação", valor: (l) => l.variacao, largura: 22 },
    { titulo: "SKU", valor: (l) => l.sku, largura: 18 },
    { titulo: "Estoque", valor: (l) => l.estoque, largura: 10 },
    { titulo: `Vendidas em ${args.janela} dias`, valor: (l) => l.vendidas, largura: 14 },
    { titulo: "A caminho", valor: (l) => l.aCaminho, largura: 10 },
    { titulo: "Comprar", valor: (l) => l.sugerido, largura: 10 },
    { titulo: "Custo unitário", valor: (l) => l.custo, largura: 14, formato: "#,##0.00" },
    { titulo: "Investimento", valor: (l) => (l.custo === null ? null : Math.round(l.custo * l.sugerido * 100) / 100), largura: 14, formato: "#,##0.00" },
  ], linhas);
  await query(`INSERT INTO audit_log (store_id, actor_email, acao, entidade, depois) VALUES ($1::uuid, $2, 'compra.exportar', 'compra', $3::jsonb)`, [store.id, admin.email, JSON.stringify({ linhas: linhas.length, ...args })]);
  return respostaXlsx(buf, "lista-de-compras");
}
