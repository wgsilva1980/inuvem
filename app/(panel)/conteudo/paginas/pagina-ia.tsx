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
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [titulo, setTitulo] = useState("");
  const [, setTick] = useState(0);
  const editorRef = useRef<HTMLDivElement>(null);
  const [versao, setVersao] = useState(0);
  const [publicar, setPublicar] = useState(false);

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

  async function criar() {
    setCriando(true);
    setErro(null);
    setOk(null);
    try {
      const res = await fetch("/api/conteudo/paginas/criar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ titulo, html: lerHtml(), publicar }) });
      const data = (await res.json().catch(() => ({}))) as { error?: string; publicada?: boolean };
      if (!res.ok) throw new Error(data.error ?? "Não foi possível criar a página.");
      setOk(data.publicada ? "Página criada e publicada na loja." : "Página criada na loja como rascunho (não publicada). Publique pelo painel da Nuvemshop quando quiser.");
      setRascunho(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao criar a página.");
    } finally {
      setCriando(false);
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
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={publicar} disabled={faltam > 0} onChange={(e) => setPublicar(e.target.checked)} />
            Publicar agora{faltam > 0 ? ` (ainda há ${faltam} “[preencher: …]”)` : " (desmarcado = fica como rascunho)"}
          </label>
          <div>
            <Button type="button" onClick={criar} disabled={criando || titulo.trim().length < 2}>
              {criando ? "Criando…" : publicar ? "Criar e publicar a página" : "Criar página como rascunho"}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
