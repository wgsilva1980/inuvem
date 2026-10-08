"use client";

import { useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fieldClass } from "@/components/ui/field";
import { MAX_FOTOS_IA, type FotoAnalisada, type RascunhoAtual, type RascunhoIA } from "@/lib/catalog/ai-draft-shared";
import type { CategoryOption } from "@/lib/catalog/query";
import { miniaturaParaAnalise, prepareImageFile } from "@/lib/client/compress-image";
import { estimarCustoUsd } from "@/lib/images/custo";
import { NewProductForm, type Inicial } from "./new-product-form";

interface Foto {
  id: string;
  file: File;
  /** Prévia no navegador. */
  url: string;
  /** Cópia pequena que vai para a análise. */
  mini: Blob;
  ia?: FotoAnalisada;
}

const CORES_QUALIDADE = ["", "text-danger", "text-danger", "text-warning", "text-success", "text-success"];

function copiar(texto: string) {
  void navigator.clipboard?.writeText(texto).catch(() => undefined);
}

/**
 * Cadastro pela foto: a pessoa sobe as fotos da peça (e, se quiser, anota o que já sabe) e a IA deixa o formulário preenchido.
 * Nada vai para a loja até a pessoa conferir e clicar em "Criar produto".
 */
export function NovoProduto({ categories }: { categories: CategoryOption[] }) {
  const [fotos, setFotos] = useState<Foto[]>([]);
  const [anotacoes, setAnotacoes] = useState("");
  const [ajuste, setAjuste] = useState("");
  const [analisando, setAnalisando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [inicial, setInicial] = useState<Inicial | null>(null);
  const [custo, setCusto] = useState(0);
  const [arrastando, setArrastando] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const atualRef = useRef<() => RascunhoAtual>(() => ({}));

  async function adicionar(arquivos: FileList | File[]) {
    setErro(null);
    for (const original of Array.from(arquivos)) {
      if (fotos.length >= MAX_FOTOS_IA) {
        setErro(`Use no máximo ${MAX_FOTOS_IA} fotos de cada vez.`);
        break;
      }
      if (!/^image\/(jpeg|png|webp)$/.test(original.type)) {
        setErro(`${original.name}: use fotos JPEG, PNG ou WEBP.`);
        continue;
      }
      try {
        const file = await prepareImageFile(original);
        const mini = await miniaturaParaAnalise(file);
        setFotos((lista) => (lista.length >= MAX_FOTOS_IA ? lista : [...lista, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, file, url: URL.createObjectURL(file), mini }]));
      } catch (e) {
        setErro(`${original.name}: ${e instanceof Error ? e.message : "não foi possível ler a imagem."}`);
      }
    }
    if (input.current) input.current.value = "";
  }

  function remover(id: string) {
    setFotos((lista) => {
      const f = lista.find((x) => x.id === id);
      if (f) URL.revokeObjectURL(f.url);
      return lista.filter((x) => x.id !== id);
    });
  }

  function mover(id: string, delta: -1 | 1) {
    setFotos((lista) => {
      const i = lista.findIndex((x) => x.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= lista.length) return lista;
      const nova = [...lista];
      [nova[i], nova[j]] = [nova[j]!, nova[i]!];
      return nova;
    });
  }

  async function analisar(comAjuste: boolean) {
    if (fotos.length === 0 || analisando) return;
    if (comAjuste && !window.confirm("Gerar de novo substitui o nome, a descrição, as tags e o SEO que estão na tela (as edições nesses campos se perdem). Continuar?")) return;
    setAnalisando(true);
    setErro(null);
    try {
      const body = new FormData();
      fotos.forEach((f, i) => body.append("fotos", f.mini, `foto-${i + 1}.jpg`));
      body.set("anotacoes", anotacoes);
      if (comAjuste) {
        body.set("ajuste", ajuste);
        body.set("atual", JSON.stringify(atualRef.current()));
      }
      const res = await fetch("/api/produtos/ia/analisar", { method: "POST", body });
      const json = (await res.json().catch(() => ({}))) as Partial<RascunhoIA> & { error?: string };
      if (!res.ok || !json.nome) {
        setErro(json.error ?? "Não foi possível analisar as fotos agora. Tente de novo.");
        return;
      }
      const r = json as RascunhoIA;
      setCusto((c) => c + estimarCustoUsd(r.entrada, r.saida));
      // anexa a análise de cada foto; na primeira análise a foto principal sugerida vai para o início
      const base = fotos.map((f, i) => ({ ...f, ia: r.fotos[i] }));
      const principal = !comAjuste && r.fotoPrincipal > 0 ? base[r.fotoPrincipal] : undefined;
      setFotos(principal ? [principal, ...base.filter((f) => f !== principal)] : base);
      setInicial((anterior) => ({ versao: (anterior?.versao ?? 0) + 1, modo: comAjuste ? "ajuste" : "completo", dados: r }));
      setAjuste("");
    } catch {
      setErro("Não foi possível analisar as fotos agora. Verifique a conexão e tente de novo.");
    } finally {
      setAnalisando(false);
    }
  }

  const analisada = inicial !== null;

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold">Comece pela foto</h2>
          <p className="text-sm text-muted">
            Escolha as fotos da peça e, se quiser, anote o que você já sabe. A IA preenche nome, descrição, categoria, tags, cores, SEO e o texto alternativo das fotos; você confere tudo antes de criar. Preço, tamanhos, peso e estoque só entram se você anotar.
          </p>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setArrastando(true);
          }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(e) => {
            e.preventDefault();
            setArrastando(false);
            if (e.dataTransfer.files.length > 0) void adicionar(e.dataTransfer.files);
          }}
          className={`flex flex-col items-center gap-2 rounded-md border-2 border-dashed p-5 text-center text-sm ${arrastando ? "border-primary bg-primary/5" : "border-border"}`}
        >
          <p className="font-medium">Arraste as fotos aqui ou escolha arquivos</p>
          <p className="text-xs text-muted">Até {MAX_FOTOS_IA} fotos (JPEG, PNG ou WEBP) da mesma peça. A primeira é a principal; a IA sugere qual fica melhor.</p>
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" id="fotos-novo-produto" onChange={(e) => e.target.files && void adicionar(e.target.files)} />
          <label htmlFor="fotos-novo-produto" className="cursor-pointer rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-border/40">
            Escolher arquivos
          </label>
        </div>

        {fotos.length > 0 && (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {fotos.map((f, i) => (
              <li key={f.id} className="flex gap-3 rounded-md border border-border p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.url} alt={`Foto ${i + 1}`} className="size-24 shrink-0 rounded object-cover" />
                <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                  <div className="flex flex-wrap items-center gap-x-2">
                    {i === 0 ? <span className="text-xs font-medium text-primary">★ Principal</span> : <span className="text-xs text-muted">Foto {i + 1}</span>}
                    {f.ia && <span className={`text-xs font-medium ${CORES_QUALIDADE[f.ia.qualidade] ?? ""}`}>Qualidade {f.ia.qualidade}/5</span>}
                  </div>
                  {f.ia?.observacao && <p className="text-xs text-muted">{f.ia.observacao}</p>}
                  {f.ia?.alt && (
                    <div className="flex items-start gap-2">
                      <p className="min-w-0 flex-1 text-xs">
                        <span className="font-medium">Texto alternativo:</span> {f.ia.alt}
                      </p>
                      <button type="button" onClick={() => copiar(f.ia!.alt)} className="shrink-0 text-xs underline">
                        Copiar
                      </button>
                    </div>
                  )}
                  <div className="mt-auto flex gap-1">
                    <button type="button" disabled={i === 0 || analisando} onClick={() => mover(f.id, -1)} aria-label="Mover para antes" className="min-h-8 min-w-8 rounded border border-border text-sm hover:bg-border/40 disabled:opacity-40">
                      ←
                    </button>
                    <button type="button" disabled={i === fotos.length - 1 || analisando} onClick={() => mover(f.id, 1)} aria-label="Mover para depois" className="min-h-8 min-w-8 rounded border border-border text-sm hover:bg-border/40 disabled:opacity-40">
                      →
                    </button>
                    <button type="button" disabled={analisando} onClick={() => remover(f.id)} aria-label="Remover foto" className="min-h-8 min-w-8 rounded border border-border text-sm text-danger hover:bg-border/40 disabled:opacity-40">
                      ✕
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">O que você já sabe da peça (opcional)</span>
          <textarea
            value={anotacoes}
            onChange={(e) => setAnotacoes(e.target.value)}
            rows={3}
            maxLength={3000}
            placeholder="Ex.: viscose com elastano, tamanhos P, M e G, R$ 189,90, forro até o joelho"
            className={fieldClass}
          />
          <span className="text-xs text-muted">Tecido, tamanhos, preço, peso, medidas… A IA só usa o que está escrito aqui ou o que aparece na foto.</span>
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" disabled={fotos.length === 0 || analisando} onClick={() => void analisar(false)}>
            {analisando ? "Analisando as fotos…" : analisada ? "Analisar de novo" : "Analisar com IA"}
          </Button>
          {analisando && <span className="text-sm text-muted">Leva em torno de 10 a 20 segundos.</span>}
          {custo > 0 && !analisando && <span className="text-xs text-muted">Custo estimado até agora: US$ {custo.toFixed(2)}</span>}
        </div>

        {erro && (
          <Alert tone="danger" role="alert">
            {erro}
          </Alert>
        )}

        {analisada && (
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            {inicial.dados.avisos.map((a) => (
              <p key={a} className="text-sm text-warning">
                ⚠ {a}
              </p>
            ))}
            <p className="text-sm text-muted">Os campos marcados com “✨ Sugerido pela IA” estão preenchidos abaixo; os que ela não tem como saber (preço, tamanhos, peso) estão destacados em laranja quando faltam.</p>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Peça um ajuste nos textos (opcional)</span>
              <input value={ajuste} onChange={(e) => setAjuste(e.target.value)} maxLength={500} placeholder="Ex.: mais curta; destaque o decote; tom mais casual" className={fieldClass} />
            </label>
            <div>
              <Button type="button" variant="outline" disabled={analisando || ajuste.trim() === ""} onClick={() => void analisar(true)}>
                {analisando ? "Gerando…" : "Gerar os textos de novo com esse ajuste"}
              </Button>
            </div>
          </div>
        )}
      </Card>

      <NewProductForm categories={categories} fotos={fotos.map((f) => ({ id: f.id, file: f.file }))} inicial={inicial} atualRef={atualRef} />
    </div>
  );
}
