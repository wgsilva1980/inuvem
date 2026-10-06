import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { query } from "@/lib/db";
import { MODELO_REVISAO, PROBLEMA_VISUAL_LABEL, estimarCustoUsd, resumoRevisao, type ProblemaVisual } from "@/lib/images/review";
import { getActiveStore } from "@/lib/stores";
import { AltEditor } from "./alt-editor";
import { ApplyAltRunner, ReviewRunner } from "./runners";

export const dynamic = "force-dynamic";
const POR_PAGINA = 20;
type Filtro = "problemas" | "sem-alt" | "todas";

interface Linha {
  product_id: string;
  produto: string;
  image_id: string;
  src: string;
  position: number | null;
  alt_loja: string;
  alt_pt: string | null;
  quality: number | null;
  problems: string[] | null;
  note: string | null;
  error: string | null;
  revisada: boolean;
}

export default async function RevisaoPage({ searchParams }: { searchParams: Promise<{ filtro?: string; page?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const store = await getActiveStore();
  const filtro: Filtro = sp.filtro === "sem-alt" || sp.filtro === "todas" ? sp.filtro : "problemas";
  const configurado = Boolean(process.env.ANTHROPIC_API_KEY);

  const resumo = store ? await resumoRevisao({ query }, store.id) : null;
  const linhas = store
    ? await query<Linha>(
        `SELECT p.id::text AS product_id, p.name AS produto, (i->>'id') AS image_id, (i->>'src') AS src, nullif(i->>'position', '')::int AS position,
                coalesce(i->'alt'->>'pt', CASE WHEN jsonb_typeof(i->'alt') = 'array' THEN i->'alt'->>0 END, '') AS alt_loja,
                r.alt_pt, r.quality, r.problems, r.note, r.error, (r.image_id IS NOT NULL AND r.src = (i->>'src')) AS revisada
         FROM products p
         CROSS JOIN LATERAL jsonb_array_elements(coalesce(p.raw_json->'images', '[]'::jsonb)) AS i
         LEFT JOIN image_review r ON r.store_id = p.store_id AND r.image_id = (i->>'id')::bigint
         WHERE p.store_id = $1::uuid AND (i->>'src') IS NOT NULL
         ORDER BY p.id, nullif(i->>'position', '')::int NULLS LAST`,
        [store.id],
      )
    : [];
  const filtradas = linhas.filter((l) => {
    if (filtro === "todas") return l.revisada && !l.error;
    if (filtro === "sem-alt") return l.alt_loja === "";
    return l.revisada && !l.error && ((l.problems ?? []).length > 0 || (l.quality ?? 5) <= 3);
  });
  // agrupa por produto (a lista já vem ordenada por produto)
  const grupos: Array<{ id: string; nome: string; fotos: Linha[] }> = [];
  for (const l of filtradas) {
    const g = grupos[grupos.length - 1];
    if (g && g.id === l.product_id) g.fotos.push(l);
    else grupos.push({ id: l.product_id, nome: l.produto, fotos: [l] });
  }
  const pages = Math.max(1, Math.ceil(grupos.length / POR_PAGINA));
  const page = Math.min(Math.max(1, Number(sp.page) || 1), pages);
  const visiveis = grupos.slice((page - 1) * POR_PAGINA, page * POR_PAGINA);
  const href = (f: Filtro, p = 1) => `/imagens/revisao?filtro=${f}${p > 1 ? `&page=${p}` : ""}`;
  const custo = resumo ? estimarCustoUsd(resumo.entrada, resumo.saida) : 0;

  return (
    <main className="flex max-w-5xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Link href="/imagens" className="text-sm text-muted hover:underline">
          ← Imagens
        </Link>
        <h1 className="text-xl font-semibold">Revisão das fotos com o Claude</h1>
        <Link href="/imagens/teste-alt" className="text-sm underline">
          O texto não grava na loja? Testar como a Nuvemshop aceita o texto alternativo →
        </Link>
        <p className="text-sm text-muted">
          O Claude olha cada foto e sugere o texto alternativo (alt, em português), uma nota de 1 a 5 e problemas visíveis (desfocada, escura, cortada, fundo poluído…). Revisar não altera nada na loja; o envio dos textos é um passo à parte e dá para editar cada um.
        </p>
      </div>

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
              {resumo.revisadas} de {resumo.fotos} fotos revisadas{resumo.comErro ? ` (${resumo.comErro} com erro, serão tentadas de novo)` : ""}. Modelo: {MODELO_REVISAO}. Uso até agora: {resumo.entrada.toLocaleString("pt-BR")} tokens de entrada e {resumo.saida.toLocaleString("pt-BR")} de saída (custo estimado de US$ {custo.toFixed(2)}).
            </p>
            <ReviewRunner fotos={resumo.fotos} revisadas={resumo.revisadas} />
          </Card>

          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Nota 5", resumo.porQualidade[5]!],
              ["Nota 4", resumo.porQualidade[4]!],
              ["Nota 3", resumo.porQualidade[3]!],
              ["Nota 1 ou 2", resumo.porQualidade[1]! + resumo.porQualidade[2]!],
              ["Com problema visual ou nota ≤ 3", resumo.comProblema],
              ["Sem texto alternativo na loja", resumo.semAltNaLoja],
              ["Textos prontos para enviar", resumo.altPendentes],
            ].map(([titulo, valor]) => (
              <li key={titulo as string} className="flex flex-col rounded-md border border-border bg-card p-3">
                <span className="text-2xl font-semibold">{valor}</span>
                <span className="text-xs text-muted">{titulo}</span>
              </li>
            ))}
          </ul>

          <Card className="flex flex-col gap-2">
            <h2 className="text-base font-semibold">Enviar textos alternativos</h2>
            <p className="text-sm">Envia à loja os textos sugeridos para as fotos que hoje estão sem texto (e os que você editou). Recomendo testar antes salvando um texto em uma foto abaixo e conferindo na loja.</p>
            <ApplyAltRunner pendentes={resumo.altPendentes} />
          </Card>
        </>
      )}

      <nav aria-label="Filtro" className="flex flex-wrap gap-2 text-sm">
        {(
          [
            ["problemas", "Com problema ou nota ≤ 3"],
            ["sem-alt", "Sem texto na loja"],
            ["todas", "Todas as revisadas"],
          ] as Array<[Filtro, string]>
        ).map(([f, rotulo]) => (
          <Link key={f} href={href(f)} aria-current={filtro === f ? "page" : undefined} className={`rounded-full border px-3 py-1 ${filtro === f ? "border-primary bg-primary text-primary-foreground" : "border-border-strong hover:bg-border/40"}`}>
            {rotulo}
          </Link>
        ))}
      </nav>

      {grupos.length === 0 ? (
        <EmptyState title={resumo && resumo.revisadas === 0 ? "Nenhuma foto revisada ainda" : "Nada neste filtro"}>
          <p className="text-muted">{resumo && resumo.revisadas === 0 ? "Use “Testar com 10 fotos” para começar." : "Nenhuma foto encontrada com este filtro."}</p>
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {visiveis.map((g) => (
            <li key={g.id}>
              <Card className="flex flex-col gap-3">
                <Link href={`/produtos/${g.id}`} className="font-medium hover:underline">
                  {g.nome}
                </Link>
                <ul className="flex flex-col divide-y divide-border">
                  {g.fotos.map((f) => (
                    <li key={f.image_id} className="flex flex-col gap-2 py-3 sm:flex-row">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={f.src} alt="" width={96} height={96} loading="lazy" className="h-24 w-24 shrink-0 rounded border border-border object-cover" />
                      <div className="flex min-w-0 flex-1 flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-1 text-sm">
                          <span className="text-muted">#{f.position ?? "–"}</span>
                          {f.revisada && !f.error ? <Badge tone={(f.quality ?? 0) >= 4 ? "success" : (f.quality ?? 0) === 3 ? "warning" : "danger"}>Nota {f.quality}/5</Badge> : <Badge>Não revisada</Badge>}
                          {(f.problems ?? []).map((p) => (
                            <Badge key={p} tone="warning">
                              {PROBLEMA_VISUAL_LABEL[p as ProblemaVisual] ?? p}
                            </Badge>
                          ))}
                        </div>
                        {f.note && <p className="text-sm text-muted">{f.note}</p>}
                        {f.revisada && !f.error && <AltEditor productId={Number(g.id)} imageId={f.image_id} texto={f.alt_pt ?? ""} naLoja={f.alt_loja} />}
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} pages={pages} href={(p) => href(filtro, p)} />
    </main>
  );
}
