import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { query } from "@/lib/db";
import { MODELO_REVISAO, PROBLEMA_VISUAL_LABEL, estimarCustoUsd, linhasRevisao, resumoRevisao, type LinhaRevisao, type ProblemaVisual } from "@/lib/images/review";
import { getActiveStore } from "@/lib/stores";
import { CopyButton } from "./copy-button";
import { ReviewRunner } from "./runners";

export const dynamic = "force-dynamic";
const POR_PAGINA = 25;
type Filtro = "problemas" | "todas";

const temProblema = (l: LinhaRevisao) => l.problems.length > 0 || (l.quality ?? 5) <= 3;

export default async function RevisaoPage({ searchParams }: { searchParams: Promise<{ filtro?: string; page?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const store = await getActiveStore();
  const filtro: Filtro = sp.filtro === "todas" ? "todas" : "problemas";
  const configurado = Boolean(process.env.ANTHROPIC_API_KEY);

  const resumo = store ? await resumoRevisao({ query }, store.id) : null;
  const linhas = store ? await linhasRevisao({ query }, store.id) : [];
  const lista = linhas.filter((l) => l.revisada && !l.error && (filtro === "todas" || temProblema(l)));
  const pages = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
  const page = Math.min(Math.max(1, Number(sp.page) || 1), pages);
  const visiveis = lista.slice((page - 1) * POR_PAGINA, page * POR_PAGINA);
  const href = (f: Filtro, p = 1) => `/imagens/revisao?filtro=${f}${p > 1 ? `&page=${p}` : ""}`;
  const custo = resumo ? estimarCustoUsd(resumo.entrada, resumo.saida) : 0;

  return (
    <main className="flex max-w-5xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Link href="/imagens" className="text-sm text-muted hover:underline">
          ← Imagens
        </Link>
        <h1 className="text-xl font-semibold">Revisão das fotos principais com o Claude</h1>
        <p className="text-sm text-muted">
          O Claude olha a <strong>foto principal</strong> de cada produto e sugere um texto alternativo (alt, em português, só sobre a peça), uma nota de 1 a 5 e os problemas visíveis (desfocada, escura, peça não aparece…). Revisar não altera nada na loja.
        </p>
      </div>

      <Card className="text-sm">
        <p className="font-medium">A Nuvemshop não deixa gravar o texto alternativo pela API.</p>
        <p className="text-muted">
          Testamos três rotas (PUT da foto, foto enviada já com o texto e PUT do produto) e a loja ignora ou recusa. Por isso os textos daqui são para <strong>colar à mão</strong> no painel da Nuvemshop (Produtos → foto → “Texto alternativo”): use “Copiar texto” em cada foto ou baixe a planilha com todos.
        </p>
      </Card>

      {!configurado && (
        <Card className="text-sm">
          <p className="font-medium">Falta configurar a chave da API da Anthropic.</p>
          <p className="text-muted">
            Crie uma chave em console.anthropic.com e cadastre na Vercel (Settings → Environment Variables) como <code>ANTHROPIC_API_KEY</code>, nos ambientes Production e Preview, e faça um novo deploy. Se a Anthropic responder que a chave não está ligada a um workspace, cadastre também <code>ANTHROPIC_WORKSPACE_ID</code> com o ID do workspace. Nunca cole a chave no chat ou no código.
          </p>
        </Card>
      )}

      {resumo && (
        <>
          <Card className="flex flex-col gap-3">
            <p className="text-sm">
              {resumo.revisadas} de {resumo.fotos} fotos principais revisadas{resumo.comErro ? ` (${resumo.comErro} com erro, serão tentadas de novo)` : ""}. Modelo: {MODELO_REVISAO}. Uso até agora: {resumo.entrada.toLocaleString("pt-BR")} tokens de entrada e {resumo.saida.toLocaleString("pt-BR")} de saída (custo estimado de US$ {custo.toFixed(2)}).
            </p>
            <ReviewRunner fotos={resumo.fotos} revisadas={resumo.revisadas} />
            <div>
              <a href="/api/images/review/export" className={buttonClass("outline")} download>
                Baixar planilha com os textos (CSV)
              </a>
            </div>
          </Card>

          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[
              ["Nota 5", resumo.porQualidade[5]!],
              ["Nota 4", resumo.porQualidade[4]!],
              ["Nota 3", resumo.porQualidade[3]!],
              ["Nota 1 ou 2", resumo.porQualidade[1]! + resumo.porQualidade[2]!],
              ["Com problema visual ou nota ≤ 3", resumo.comProblema],
            ].map(([titulo, valor]) => (
              <li key={titulo as string} className="flex flex-col rounded-md border border-border bg-card p-3">
                <span className="text-2xl font-semibold">{valor}</span>
                <span className="text-xs text-muted">{titulo}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <nav aria-label="Filtro" className="flex flex-wrap gap-2 text-sm">
        {(
          [
            ["problemas", "Com problema ou nota ≤ 3"],
            ["todas", "Todas as revisadas"],
          ] as Array<[Filtro, string]>
        ).map(([f, rotulo]) => (
          <Link key={f} href={href(f)} aria-current={filtro === f ? "page" : undefined} className={`rounded-full border px-3 py-1 ${filtro === f ? "border-primary bg-primary text-primary-foreground" : "border-border-strong hover:bg-border/40"}`}>
            {rotulo}
          </Link>
        ))}
      </nav>

      {lista.length === 0 ? (
        <EmptyState title={resumo && resumo.revisadas === 0 ? "Nenhuma foto revisada ainda" : "Nada neste filtro"}>
          <p className="text-muted">{resumo && resumo.revisadas === 0 ? "Use “Testar com 10 fotos” para começar." : "Nenhuma foto com este filtro."}</p>
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {visiveis.map((l) => (
            <li key={l.product_id}>
              <Card className="flex flex-col gap-3 sm:flex-row">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={l.src} alt="" width={112} height={112} loading="lazy" className="h-28 w-28 shrink-0 rounded border border-border object-cover" />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <Link href={`/produtos/${l.product_id}`} className="font-medium hover:underline">
                    {l.produto}
                  </Link>
                  <div className="flex flex-wrap items-center gap-1 text-sm">
                    <Badge tone={(l.quality ?? 0) >= 4 ? "success" : (l.quality ?? 0) === 3 ? "warning" : "danger"}>Nota {l.quality}/5</Badge>
                    {l.problems.map((p) => (
                      <Badge key={p} tone="warning">
                        {PROBLEMA_VISUAL_LABEL[p as ProblemaVisual] ?? p}
                      </Badge>
                    ))}
                  </div>
                  {l.note && <p className="text-sm text-muted">{l.note}</p>}
                  {l.alt_pt && (
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-muted">Texto alternativo sugerido ({l.alt_pt.length} caracteres)</span>
                      <p className="rounded border border-border bg-card px-3 py-2 text-sm">{l.alt_pt}</p>
                      <CopyButton texto={l.alt_pt} />
                    </div>
                  )}
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
