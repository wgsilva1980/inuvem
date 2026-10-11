"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fieldBase } from "@/components/ui/field";
import { RichTextEditor } from "@/components/rich-text-editor";

const EXEMPLO = `Tamanho;Busto;Cintura;Quadril
P;84;66;92
M;88;70;96
G;92;74;100
GG;96;78;104`;

interface Montado {
  titulo: string;
  html: string;
  erros: string[];
  avisos: string[];
}

export function GuiaMedidas() {
  const [texto, setTexto] = useState(EXEMPLO);
  const [tipo, setTipo] = useState<"corpo" | "peca">("corpo");
  const [comoMedir, setComoMedir] = useState(true);
  const [montando, setMontando] = useState(false);
  const [erros, setErros] = useState<string[]>([]);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [html, setHtml] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  async function montar() {
    setMontando(true);
    setMsg(null);
    try {
      const res = await fetch("/api/conteudo/medidas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ texto, tipo, comoMedir }) });
      const data = (await res.json().catch(() => ({}))) as Partial<Montado> & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Não foi possível montar o guia.");
      setErros(data.erros ?? []);
      setAvisos(data.avisos ?? []);
      if (data.html) {
        setHtml(data.html);
        setVersao((v) => v + 1);
      }
    } catch (e) {
      setErros([e instanceof Error ? e.message : "Falha ao montar o guia."]);
    } finally {
      setMontando(false);
    }
  }

  /** O editor guarda o HTML num campo escondido; é de lá que leio o texto revisado. */
  const lerHtml = () => editorRef.current?.querySelector<HTMLInputElement>('input[name="guia_html"]')?.value ?? html ?? "";

  async function copiar(que: "titulo" | "texto" | "html") {
    setMsg(null);
    const h = lerHtml();
    try {
      if (que === "titulo") await navigator.clipboard.writeText("Guia de medidas");
      else if (que === "html") await navigator.clipboard.writeText(h);
      else {
        const plano = h.replace(/<\/(p|h[1-6]|li)>/gi, "\n").replace(/<\/t[dh]>/gi, "\t").replace(/<\/tr>/gi, "\n").replace(/<[^>]*>/g, "").replace(/\n{3,}/g, "\n\n").trim();
        try {
          await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([h], { type: "text/html" }), "text/plain": new Blob([plano], { type: "text/plain" }) })]);
        } catch {
          await navigator.clipboard.writeText(h);
        }
      }
      setMsg({ ok: true, texto: que === "titulo" ? "Título copiado." : que === "html" ? "HTML copiado." : "Guia copiado com a formatação." });
    } catch {
      setMsg({ ok: false, texto: "Não consegui copiar; selecione o texto no editor e copie à mão." });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Tabela de medidas</span>
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={8} maxLength={4000} spellCheck={false} className={`${fieldBase} font-mono`} />
          <span className="text-xs text-muted">
            Primeira linha: os títulos (Tamanho;Busto;Cintura…). Depois, uma linha por tamanho. Separe com ponto e vírgula ou cole direto de uma planilha. Use números em centímetros; faixa como 86-90 também vale.
          </span>
        </label>
        <fieldset className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <legend className="sr-only">Opções</legend>
          <label className="flex min-h-11 items-center gap-2">
            <input type="radio" name="tipo" checked={tipo === "corpo"} onChange={() => setTipo("corpo")} className="size-4" />
            Medidas do corpo
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input type="radio" name="tipo" checked={tipo === "peca"} onChange={() => setTipo("peca")} className="size-4" />
            Medidas da peça
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" checked={comoMedir} onChange={(e) => setComoMedir(e.target.checked)} className="size-4" />
            Incluir “Como medir”
          </label>
        </fieldset>
        <div>
          <Button type="button" onClick={montar} disabled={montando || texto.trim() === ""}>
            {montando ? "Montando…" : html ? "Montar de novo" : "Montar guia"}
          </Button>
        </div>
      </Card>

      {erros.length > 0 && (
        <div role="alert" className="rounded-md border border-border bg-card p-3 text-sm text-danger">
          <p className="font-medium">Corrija a tabela:</p>
          <ul className="list-disc pl-5">
            {erros.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {avisos.length > 0 && (
        <div className="rounded-md border border-border bg-card p-3 text-sm text-warning">
          <p className="font-medium">Confira:</p>
          <ul className="list-disc pl-5">
            {avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}
      {msg && (
        <p role="status" className={`rounded-md border bg-card p-3 text-sm ${msg.ok ? "border-success/40 text-success" : "border-border text-danger"}`}>
          {msg.texto}
        </p>
      )}

      {html && (
        <Card className="flex flex-col gap-3">
          <h2 className="font-medium">Guia para revisar</h2>
          <div ref={editorRef}>
            <RichTextEditor key={versao} name="guia_html" defaultValue={html} id="guia-editor" onChange={() => setMsg(null)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="min-h-11" onClick={() => copiar("titulo")}>
              Copiar título
            </Button>
            <Button type="button" className="min-h-11" onClick={() => copiar("texto")}>
              Copiar guia com formatação
            </Button>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => copiar("html")}>
              Copiar HTML
            </Button>
          </div>
          <p className="text-xs text-muted">
            A Nuvemshop não deixa o painel criar páginas. No admin da Nuvemshop, vá em Loja online → Páginas → Criar, cole o título e o guia (se a tabela não vier formatada, use “Copiar HTML” e cole no modo de código do editor). Para mostrar nos produtos, coloque o link da página na descrição.
          </p>
        </Card>
      )}
    </div>
  );
}
