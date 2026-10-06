import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { query } from "@/lib/db";
import { MODELO_REVISAO, estimarCustoUsd } from "@/lib/images/review";
import { contarParaAplicar, listarSeo, resumoSeo, type LinhaSeo } from "@/lib/seo/repo";
import { getActiveStore } from "@/lib/stores";
import { ApplyRunner, GenerateRunner } from "./runners";
import { SeoEditor } from "./seo-editor";

export const dynamic = "force-dynamic";
const POR_PAGINA = 15;
type Filtro = "revisar" | "sem-seo" | "aplicados" | "erros";

const FILTROS: Array<[Filtro, string]> = [
  ["revisar", "Para revisar"],
  ["sem-seo", "Sem SEO na loja"],
  ["aplicados", "Já gravados"],
  ["erros", "Com erro"],
];

function filtrar(linhas: LinhaSeo[], filtro: Filtro): LinhaSeo[] {
  switch (filtro) {
    case "sem-seo":
      return linhas.filter((l) => l.titulo && !l.erro && (l.seo_titulo === "" || l.seo_descricao === ""));
    case "aplicados":
      return linhas.filter((l) => l.aplicado);
    case "erros":
      return linhas.filter((l) => l.erro);
    default:
      return linhas.filter((l) => l.titulo && !l.erro && !l.aplicado && !l.igual);
  }
}

export default async function SeoPage({ searchParams }: { searchParams: Promise<{ filtro?: string; page?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const store = await getActiveStore();
  const filtro = (FILTROS.map((f) => f[0]) as string[]).includes(sp.filtro ?? "") ? (sp.filtro as Filtro) : "revisar";
  const configurado = Boolean(process.env.ANTHROPIC_API_KEY);

  const db = { query };
  const resumo = store ? await resumoSeo(db, store.id) : null;
  const contagem = store ? await contarParaAplicar(db, store.id) : { vazios: 0, todos: 0 };
  const linhas = store ? await listarSeo(db, store.id) : [];
  const lista = filtrar(linhas, filtro);
  const pages = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
  const page = Math.min(Math.max(1, Number(sp.page) || 1), pages);
  const visiveis = lista.slice((page - 1) * POR_PAGINA, page * POR_PAGINA);
  const href = (f: Filtro, p = 1) => `/seo?filtro=${f}${p > 1 ? `&page=${p}` : ""}`;
  const custo = resumo ? estimarCustoUsd(resumo.entrada, resumo.saida) : 0;

  return (
    <main className="flex max-w-5xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">SEO com o Claude</h1>
        <p className="text-sm text-muted">
          O Claude escreve, para cada produto, o <strong>título de SEO</strong> (até 70 caracteres, terminando em “| Donatelle Concept”) e a <strong>descrição de SEO</strong> (até 320), usando o nome, as categorias, as variações, a descrição atual e a foto principal. Gerar não altera a loja; você revisa, edita se quiser e só então grava.
        </p>
      </div>

      {!configurado && (
        <Card className="text-sm">
          <p className="font-medium">Falta configurar a chave da API da Anthropic.</p>
          <p className="text-muted">
            Cadastre <code>ANTHROPIC_API_KEY</code> (e, se a Anthropic pedir, <code>ANTHROPIC_WORKSPACE_ID</code>) na Vercel (Settings → Environment Variables), em Production e Preview, e faça um novo deploy. Nunca cole a chave no chat ou no código.
          </p>
        </Card>
      )}

      {resumo && (
        <>
          <Card className="flex flex-col gap-3">
            <p className="text-sm">
              {resumo.geradas} de {resumo.produtos} produtos com SEO gerado{resumo.comErro ? ` (${resumo.comErro} com erro, serão tentados de novo)` : ""}; {resumo.aplicadas} já gravados na loja; {resumo.semSeo} produtos estão hoje sem título ou sem descrição de SEO. Modelo: {MODELO_REVISAO}. Uso até agora: {resumo.entrada.toLocaleString("pt-BR")} tokens de entrada e {resumo.saida.toLocaleString("pt-BR")} de saída (custo estimado de US$ {custo.toFixed(2)}).
            </p>
            <GenerateRunner produtos={resumo.produtos} geradas={resumo.geradas} />
          </Card>

          <Card className="flex flex-col gap-2">
            <h2 className="text-base font-semibold">Gravar na loja</h2>
            <p className="text-sm">
              Envia o SEO sugerido (do jeito que está nesta tela, inclusive o que você editou e gravou) aos produtos ainda não gravados. “Nos que estão sem SEO” não mexe em quem já tem título ou descrição; “em todos” substitui o que existe. Cada produto vai para o Histórico com o texto antigo.
            </p>
            <ApplyRunner vazios={contagem.vazios} todos={contagem.todos} />
          </Card>
        </>
      )}

      <nav aria-label="Filtro" className="flex flex-wrap gap-2 text-sm">
        {FILTROS.map(([f, rotulo]) => (
          <Link key={f} href={href(f)} aria-current={filtro === f ? "page" : undefined} className={`rounded-full border px-3 py-1 ${filtro === f ? "border-primary bg-primary text-primary-foreground" : "border-border-strong hover:bg-border/40"}`}>
            {rotulo}
          </Link>
        ))}
      </nav>

      {lista.length === 0 ? (
        <EmptyState title={resumo && resumo.geradas === 0 ? "Nenhum SEO gerado ainda" : "Nada neste filtro"}>
          <p className="text-muted">{resumo && resumo.geradas === 0 ? "Use “Testar com 10 produtos” para começar." : "Nenhum produto com este filtro."}</p>
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {visiveis.map((l) => (
            <li key={l.product_id}>
              <Card className="flex flex-col gap-3 sm:flex-row">
                {l.foto && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={l.foto} alt="" width={96} height={96} loading="lazy" className="h-24 w-24 shrink-0 rounded border border-border object-cover" />
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/produtos/${l.product_id}`} className="font-medium hover:underline">
                      {l.produto}
                    </Link>
                    {l.aplicado && <Badge tone="success">Gravado na loja</Badge>}
                    {l.aviso && <Badge tone="warning">Confira: {l.aviso}</Badge>}
                    {l.erro && <Badge tone="danger">Erro ao gerar</Badge>}
                  </div>
                  {l.erro && <p className="text-sm text-danger">{l.erro}</p>}
                  <div className="rounded border border-border p-2 text-xs text-muted">
                    <p className="font-medium">Hoje na loja</p>
                    <p>Título: {l.seo_titulo || <em>(vazio)</em>}</p>
                    <p>Descrição: {l.seo_descricao || <em>(vazia)</em>}</p>
                  </div>
                  {l.titulo && l.descricao && <SeoEditor productId={Number(l.product_id)} titulo={l.titulo} descricao={l.descricao} aplicado={l.aplicado} />}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} pages={pages} href={(p) => href(filtro, p)} />
    </main>
  );
}
