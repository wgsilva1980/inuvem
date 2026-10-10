"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fieldBase } from "@/components/ui/field";
import { RichTextEditor } from "@/components/rich-text-editor";
import { TIPOS_PAGINA, type TipoPagina } from "@/lib/content/pagina-tipos";

interface Rascunho {
  titulo: string;
  html: string;
  faltando: string[];
}

const pendencias = (html: string) => (html.match(/\[preencher:[^\]]*\]/gi) ?? []).length;

export function PaginaIa() {
  const [tipo, setTipo] = useState<TipoPagina>("trocas");
  const [fatos, setFatos] = useState("");
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [titulo, setTitulo] = useState("");
  const [, setTick] = useState(0);
  const editorRef = useRef<HTMLDivElement>(null);
  const [versao, setVersao] = useState(0);

  async function gerar() {
    setGerando(true);
    setErro(null);
    setOk(null);
    try {
      const res = await fetch("/api/conteudo/paginas/gerar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tipo, fatos }) });
      const data = (await res.json().catch(() => ({}))) as Partial<Rascunho> & { error?: string };
      if (!res.ok || !data.html) throw new Error(data.error ?? "Não foi possível escrever a página.");
      setRascunho({ titulo: data.titulo ?? "", html: data.html, faltando: data.faltando ?? [] });
      setTitulo(data.titulo || TIPOS_PAGINA[tipo].titulo);
      setVersao((v) => v + 1);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao escrever a página.");
    } finally {
      setGerando(false);
    }
  }

  async function copiar(que: "texto" | "html" | "titulo") {
    setErro(null);
    setOk(null);
    const html = lerHtml();
    try {
      if (que === "titulo") await navigator.clipboard.writeText(titulo);
      else if (que === "html") await navigator.clipboard.writeText(html);
      else {
        const plano = html.replace(/<\/(p|h[1-6]|li)>/gi, "\n").replace(/<[^>]*>/g, "").replace(/\n{3,}/g, "\n\n").trim();
        try {
          await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([plano], { type: "text/plain" }) })]);
        } catch {
          await navigator.clipboard.writeText(html);
        }
      }
      setOk(que === "titulo" ? "Título copiado." : que === "html" ? "HTML copiado." : "Texto copiado com a formatação.");
    } catch {
      setErro("Não consegui copiar; selecione o texto no editor e copie à mão.");
    }
  }

  /** O editor guarda o HTML num campo escondido; é de lá que leio o texto revisado. */
  const lerHtml = () => editorRef.current?.querySelector<HTMLInputElement>('input[name="pagina_html"]')?.value ?? rascunho?.html ?? "";
  const faltam = pendencias(lerHtml());

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Qual página?</span>
          <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoPagina)} className={`${fieldBase} sm:max-w-xs`}>
            {(Object.keys(TIPOS_PAGINA) as TipoPagina[]).map((k) => (
              <option key={k} value={k}>
                {TIPOS_PAGINA[k].rotulo}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Fatos (o que é verdade na sua loja)</span>
          <textarea value={fatos} onChange={(e) => setFatos(e.target.value)} rows={6} maxLength={3000} placeholder={TIPOS_PAGINA[tipo].dica} className={fieldBase} />
          <span className="text-xs text-muted">Só o que você escrever aqui entra no texto. O que faltar fica marcado como “[preencher: …]”.</span>
        </label>
        <div>
          <Button type="button" onClick={gerar} disabled={gerando}>
            {gerando ? "Escrevendo…" : rascunho ? "Escrever de novo" : "Escrever rascunho"}
          </Button>
        </div>
      </Card>

      {erro && (
        <p role="alert" className="rounded-md border border-border bg-card p-3 text-sm text-danger">
          {erro}
        </p>
      )}
      {ok && (
        <p role="status" className="rounded-md border border-success/40 bg-card p-3 text-sm text-success">
          {ok}
        </p>
      )}

      {rascunho && (
        <Card className="flex flex-col gap-3">
          <h2 className="font-medium">Rascunho para revisar</h2>
          {rascunho.faltando.length > 0 && (
            <div className="rounded-md border border-border p-3 text-sm">
              <p className="font-medium">A IA precisou destas informações e não as tinha:</p>
              <ul className="list-disc pl-5 text-muted">
                {rascunho.faltando.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          )}
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Título da página</span>
            <input value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={120} className={fieldBase} />
          </label>
          <div ref={editorRef}>
            <RichTextEditor key={versao} name="pagina_html" defaultValue={rascunho.html} id="pagina-editor" onChange={() => setTick((n) => n + 1)} />
          </div>
          {faltam > 0 && <p className="text-sm text-warning">Ainda há {faltam} “[preencher: …]” no texto. Complete antes de colar na loja.</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="min-h-11" onClick={() => copiar("titulo")} disabled={titulo.trim().length < 2}>
              Copiar título
            </Button>
            <Button type="button" className="min-h-11" onClick={() => copiar("texto")}>
              Copiar texto com formatação
            </Button>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => copiar("html")}>
              Copiar HTML
            </Button>
          </div>
          <p className="text-xs text-muted">
            A Nuvemshop não deixa o painel criar páginas. No admin da Nuvemshop, vá em Loja online → Páginas → Criar, cole o título e o texto (se a formatação não vier, use “Copiar HTML” e cole no modo de código do editor). Publique só depois de revisar.
          </p>
        </Card>
      )}
    </div>
  );
}
