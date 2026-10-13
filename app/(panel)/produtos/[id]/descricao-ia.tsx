"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

interface Resposta {
  error?: string;
  descricao?: string;
  avisos?: string[];
}

const temTexto = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&nbsp;|\s+/g, " ").trim().length > 0;

/**
 * Botão "Preencher com IA" da descrição: pede ao Claude uma descrição a partir do cadastro e da foto principal (o mesmo gerador da tela Qualidade) e a
 * coloca no editor para você revisar. Nada vai para a loja até clicar em "Salvar na Nuvemshop".
 */
export function DescricaoIa({ produtoId, descricaoAtual, aoGerar }: { produtoId: string; descricaoAtual: () => string; aoGerar: (html: string) => void }) {
  const [rodando, setRodando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  async function gerar() {
    if (temTexto(descricaoAtual()) && !window.confirm("Substituir a descrição que está no editor por uma nova, escrita pela IA? O texto atual vai ser trocado aqui na tela; nada muda na loja até você clicar em “Salvar na Nuvemshop”.")) return;
    setRodando(true);
    setErro(null);
    setMsg(null);
    setAvisos([]);
    try {
      const res = await fetch("/api/qualidade/sugerir", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ produtoId, campos: ["descricao"] }) });
      const d = (await res.json()) as Resposta;
      if (!res.ok || d.error || !d.descricao) throw new Error(d.error ?? "A IA não devolveu uma descrição.");
      aoGerar(d.descricao);
      setAvisos(d.avisos ?? []);
      setMsg("Descrição preenchida. Revise o texto e clique em “Salvar na Nuvemshop” para gravar.");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível escrever a descrição agora.");
    } finally {
      setRodando(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1" role="status" aria-live="polite">
      <Button type="button" variant="outline" className="min-h-8 px-3 py-1" disabled={rodando} onClick={gerar}>
        {rodando ? "Escrevendo… (até 1 min)" : "✨ Preencher com IA"}
      </Button>
      {msg && <span className="max-w-xs text-right text-xs text-muted">{msg}</span>}
      {avisos.map((a, i) => (
        <span key={i} className="max-w-xs text-right text-xs text-danger">
          {a}
        </span>
      ))}
      {erro && (
        <span role="alert" className="max-w-xs text-right text-xs text-danger">
          {erro}
        </span>
      )}
    </div>
  );
}
