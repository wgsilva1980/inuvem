"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { sugerirIa } from "./sugerir-ia";

const temTexto = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&nbsp;|\s+/g, " ").trim().length > 0;

/**
 * Botão "Preencher descrição e tags": pede ao Claude a descrição (e as tags) do produto a partir do cadastro e da foto principal e as coloca no formulário
 * para você revisar. As tags novas se juntam às que já estão no campo. Nada vai para a loja até clicar em "Salvar na Nuvemshop".
 */
export function DescricaoIa({
  produtoId,
  descricaoAtual,
  aoGerar,
}: {
  produtoId: string;
  descricaoAtual: () => string;
  aoGerar: (r: { html: string; tags: string }) => void;
}) {
  const [rodando, setRodando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  async function gerar() {
    if (temTexto(descricaoAtual()) && !window.confirm("Substituir a descrição que está no editor por uma nova, escrita pela IA? O texto atual vai ser trocado aqui na tela; nada muda na loja até você clicar em “Salvar na Nuvemshop”. As tags novas se juntam às que já estão no campo.")) return;
    setRodando(true);
    setErro(null);
    setMsg(null);
    setAvisos([]);
    try {
      const s = await sugerirIa(produtoId, ["descricao", "tags"]);
      if (!s.descricao) throw new Error("A IA não devolveu uma descrição.");
      aoGerar({ html: s.descricao, tags: s.tags ?? "" });
      setAvisos(s.avisos);
      setMsg("Descrição e tags preenchidas. Revise e clique em “Salvar na Nuvemshop” para gravar.");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível escrever a descrição agora.");
    } finally {
      setRodando(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1" role="status" aria-live="polite">
      <Button type="button" variant="outline" className="min-h-8 px-3 py-1" disabled={rodando} onClick={gerar}>
        {rodando ? "Escrevendo… (até 1 min)" : "✨ Preencher descrição e tags"}
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
