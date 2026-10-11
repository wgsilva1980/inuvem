"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fieldBase } from "@/components/ui/field";
import type { CampoCorrigivel, Sugestao } from "@/lib/catalog/corrigir";

export interface ItemCorrigivel {
  id: string;
  nome: string;
  campos: CampoCorrigivel[];
}

const ROTULO: Record<CampoCorrigivel, string> = { descricao: "Descrição", seo: "SEO (título e descrição para o Google)", tags: "Tags" };
const LOTE_GRAVACAO = 5;

interface Revisao {
  s: Sugestao;
  /** Campos aprovados para gravar. */
  aprovados: Record<CampoCorrigivel, boolean>;
  seoTitulo: string;
  seoDescricao: string;
  tags: string;
  situacao?: { ok: boolean; texto: string };
}

const semHtml = (html: string) => html.replace(/<\/(p|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim();

export function CorrigirQualidade({ itens }: { itens: ItemCorrigivel[] }) {
  const router = useRouter();
  const [escolhidos, setEscolhidos] = useState<Set<string>>(new Set());
  const [campos, setCampos] = useState<Record<CampoCorrigivel, boolean>>({ descricao: true, seo: true, tags: true });
  const [gerando, setGerando] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [progresso, setProgresso] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [revisoes, setRevisoes] = useState<Revisao[]>([]);
  const parar = useRef(false);

  const alvo = (i: ItemCorrigivel) => i.campos.filter((c) => campos[c]);
  const selecionados = itens.filter((i) => escolhidos.has(i.id) && alvo(i).length > 0);

  function alternar(id: string) {
    setEscolhidos((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  async function gerar() {
    setGerando(true);
    setErro(null);
    parar.current = false;
    const novas: Revisao[] = [];
    const falhas: string[] = [];
    try {
      for (const [n, item] of selecionados.entries()) {
        if (parar.current) break;
        setProgresso(`Escrevendo ${n + 1} de ${selecionados.length}: ${item.nome}`);
        const res = await fetch("/api/qualidade/sugerir", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ produtoId: item.id, campos: alvo(item) }) });
        const data = (await res.json().catch(() => ({}))) as Partial<Sugestao> & { error?: string };
        if (!res.ok || !data.produtoId) {
          if (res.status === 409 || res.status === 429) {
            setErro(data.error ?? "Não foi possível continuar.");
            break;
          }
          falhas.push(`${item.nome}: ${data.error ?? "falhou"}`);
          continue;
        }
        const s = data as Sugestao;
        novas.push({
          s,
          aprovados: { descricao: s.descricao !== undefined, seo: s.seoTitulo !== undefined, tags: s.tags !== undefined },
          seoTitulo: s.seoTitulo ?? "",
          seoDescricao: s.seoDescricao ?? "",
          tags: s.tags ?? "",
        });
      }
    } catch {
      setErro("A conexão caiu no meio. As sugestões já escritas foram mantidas; gere as que faltam de novo.");
    } finally {
      setRevisoes((atual) => [...novas, ...atual.filter((r) => !novas.some((n) => n.s.produtoId === r.s.produtoId))]);
      setEscolhidos(new Set());
      setProgresso(falhas.length > 0 ? `Não consegui escrever: ${falhas.join("; ")}` : "");
      setGerando(false);
    }
  }

  const mudar = (id: string, f: (r: Revisao) => Revisao) => setRevisoes((a) => a.map((r) => (r.s.produtoId === id ? f(r) : r)));

  const paraGravar = revisoes.filter((r) => !r.situacao?.ok && (r.aprovados.descricao || r.aprovados.seo || r.aprovados.tags));

  async function gravar() {
    setGravando(true);
    setErro(null);
    try {
      for (let i = 0; i < paraGravar.length; i += LOTE_GRAVACAO) {
        const lote = paraGravar.slice(i, i + LOTE_GRAVACAO);
        const itensEnvio = lote.map((r) => ({
          produtoId: r.s.produtoId,
          antes: r.s.antes,
          ...(r.aprovados.descricao && r.s.descricao !== undefined ? { descricao: r.s.descricao } : {}),
          ...(r.aprovados.seo ? { seoTitulo: r.seoTitulo, seoDescricao: r.seoDescricao } : {}),
          ...(r.aprovados.tags ? { tags: r.tags } : {}),
        }));
        const res = await fetch("/api/qualidade/gravar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ itens: itensEnvio }) });
        const data = (await res.json().catch(() => ({}))) as { resultados?: Array<{ produtoId: string; status: string; mensagem?: string }>; error?: string };
        if (!res.ok || !data.resultados) throw new Error(data.error ?? "Não foi possível gravar.");
        for (const r of data.resultados) {
          mudar(r.produtoId, (x) => ({
            ...x,
            situacao: r.status === "gravado" ? { ok: true, texto: "Gravado na loja." } : r.status === "sem_mudanca" ? { ok: true, texto: "Já estava assim." } : { ok: false, texto: r.mensagem ?? "Não gravado." },
          }));
        }
      }
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao gravar.");
    } finally {
      setGravando(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="font-medium">Corrigir com a IA</h2>
        <p className="text-sm text-muted">
          Marque os produtos, escolha o que escrever e clique em Escrever sugestões. Nada vai para a loja até você revisar e clicar em Gravar aprovados; cada gravação fica no Histórico e pode ser desfeita em Desfazer. A IA usa só os dados do cadastro e a foto principal: não inventa tecido, medidas nem preço.
        </p>
      </div>

      <fieldset className="flex flex-wrap gap-4 text-sm">
        <legend className="sr-only">O que escrever</legend>
        {(Object.keys(ROTULO) as CampoCorrigivel[]).map((c) => (
          <label key={c} className="flex min-h-11 items-center gap-2">
            <input type="checkbox" checked={campos[c]} onChange={(e) => setCampos({ ...campos, [c]: e.target.checked })} className="size-4" />
            {ROTULO[c]}
          </label>
        ))}
      </fieldset>

      {itens.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <button type="button" className="underline" onClick={() => setEscolhidos(new Set(itens.filter((i) => alvo(i).length > 0).slice(0, 20).map((i) => i.id)))}>
              Marcar os primeiros 20
            </button>
            <button type="button" className="underline" onClick={() => setEscolhidos(new Set())}>
              Limpar
            </button>
            <span className="text-muted">{selecionados.length} marcado(s)</span>
          </div>
          <ul className="max-h-72 divide-y divide-border overflow-auto rounded-md border border-border text-sm">
            {itens.map((i) => (
              <li key={i.id}>
                <label className="flex min-h-11 items-center gap-3 px-3 py-2">
                  <input type="checkbox" checked={escolhidos.has(i.id)} onChange={() => alternar(i.id)} className="size-4" disabled={alvo(i).length === 0} />
                  <span className="flex-1">{i.nome}</span>
                  <span className="text-xs text-muted">{i.campos.map((c) => ROTULO[c].split(" ")[0]).join(", ")}</span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={gerar} disabled={gerando || gravando || selecionados.length === 0}>
          {gerando ? "Escrevendo…" : `Escrever sugestões (${selecionados.length})`}
        </Button>
        {gerando && (
          <Button type="button" variant="outline" onClick={() => (parar.current = true)}>
            Parar
          </Button>
        )}
        {progresso && <span className="text-sm text-muted">{progresso}</span>}
      </div>
      {erro && (
        <p role="alert" className="rounded-md border border-border bg-card p-3 text-sm text-danger">
          {erro}
        </p>
      )}

      {revisoes.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="font-medium">Revisar e gravar</h3>
          {revisoes.map((r) => (
            <div key={r.s.produtoId} className="flex flex-col gap-3 rounded-md border border-border p-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <a href={`/produtos/${r.s.produtoId}`} target="_blank" rel="noreferrer" className="font-medium underline">
                  {r.s.nome}
                </a>
                {r.situacao && <span className={r.situacao.ok ? "text-success" : "text-danger"}>{r.situacao.texto}</span>}
              </div>
              {r.s.avisos.length > 0 && <p className="text-warning">{r.s.avisos.join(" ")}</p>}

              {r.s.descricao !== undefined && (
                <div className="flex flex-col gap-1">
                  <label className="flex items-center gap-2 font-medium">
                    <input type="checkbox" checked={r.aprovados.descricao} onChange={(e) => mudar(r.s.produtoId, (x) => ({ ...x, aprovados: { ...x.aprovados, descricao: e.target.checked } }))} className="size-4" />
                    Descrição
                  </label>
                  <p className="text-xs text-muted">Hoje: {semHtml(r.s.antes.descricao) || "(em branco)"}</p>
                  <div className="rounded-md border border-border p-2 [&_li]:ml-4 [&_li]:list-disc [&_p]:mb-2" dangerouslySetInnerHTML={{ __html: r.s.descricao }} />
                </div>
              )}

              {r.s.seoTitulo !== undefined && (
                <div className="flex flex-col gap-1">
                  <label className="flex items-center gap-2 font-medium">
                    <input type="checkbox" checked={r.aprovados.seo} onChange={(e) => mudar(r.s.produtoId, (x) => ({ ...x, aprovados: { ...x.aprovados, seo: e.target.checked } }))} className="size-4" />
                    SEO
                  </label>
                  <p className="text-xs text-muted">Hoje: {r.s.antes.seo_titulo || "(título em branco)"} · {r.s.antes.seo_descricao || "(descrição em branco)"}</p>
                  <input aria-label="Título de SEO" value={r.seoTitulo} maxLength={70} onChange={(e) => mudar(r.s.produtoId, (x) => ({ ...x, seoTitulo: e.target.value }))} className={fieldBase} />
                  <textarea aria-label="Descrição de SEO" value={r.seoDescricao} maxLength={320} rows={3} onChange={(e) => mudar(r.s.produtoId, (x) => ({ ...x, seoDescricao: e.target.value }))} className={fieldBase} />
                  <span className="text-xs text-muted">
                    {r.seoTitulo.length}/70 e {r.seoDescricao.length}/320 caracteres
                  </span>
                </div>
              )}

              {r.s.tags !== undefined && (
                <div className="flex flex-col gap-1">
                  <label className="flex items-center gap-2 font-medium">
                    <input type="checkbox" checked={r.aprovados.tags} onChange={(e) => mudar(r.s.produtoId, (x) => ({ ...x, aprovados: { ...x.aprovados, tags: e.target.checked } }))} className="size-4" />
                    Tags
                  </label>
                  <p className="text-xs text-muted">Hoje: {r.s.antes.tags || "(sem tags)"}</p>
                  <input aria-label="Tags" value={r.tags} maxLength={300} onChange={(e) => mudar(r.s.produtoId, (x) => ({ ...x, tags: e.target.value }))} className={fieldBase} />
                </div>
              )}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={gravar} disabled={gravando || gerando || paraGravar.length === 0}>
              {gravando ? "Gravando…" : `Gravar aprovados (${paraGravar.length})`}
            </Button>
            <Button type="button" variant="outline" onClick={() => setRevisoes([])} disabled={gravando}>
              Descartar sugestões
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
