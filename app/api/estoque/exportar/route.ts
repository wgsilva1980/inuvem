import { requireAdminApi } from "@/lib/auth/admin";
import { query } from "@/lib/db";
import { COLUNAS_REPOSICAO } from "@/lib/export/colunas";
import { gerarXlsx, respostaXlsx } from "@/lib/export/xlsx";
import { classificarReposicao, variacoesComRitmo } from "@/lib/stock/insights";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const op = (v: string | null, lista: number[], padrao: number) => (lista.includes(Number(v)) ? Number(v) : padrao);

/** Planilha de reposição (esgotadas que vendiam e as que estão acabando) com os mesmos parâmetros da tela /estoque. */
export async function GET(req: Request) {
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  const p = new URL(req.url).searchParams;
  const janela = op(p.get("janela"), [14, 30, 60, 90], 30);
  const limite = op(p.get("limite"), [7, 14, 21, 30], 14);
  const cobertura = op(p.get("cobertura"), [30, 45, 60], 30);
  const { acabando, esgotados } = classificarReposicao(await variacoesComRitmo({ query }, store.id, janela), { limite, cobertura });
  const linhas = [...esgotados, ...acabando];
  const buf = await gerarXlsx("Reposição", COLUNAS_REPOSICAO, linhas);
  await query(`INSERT INTO audit_log (store_id, actor_email, acao, entidade, depois) VALUES ($1::uuid, $2, 'estoque.exportar', 'estoque', $3::jsonb)`, [
    store.id,
    admin.email,
    JSON.stringify({ linhas: linhas.length, janela, limite, cobertura }),
  ]);
  return respostaXlsx(buf, "reposicao");
}
