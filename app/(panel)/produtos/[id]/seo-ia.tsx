"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { sugerirIa } from "./sugerir-ia";

/**
 * Botão "Preencher SEO": pede ao Claude o título e a descrição de SEO do produto (nos limites de 70 e 320 caracteres) e os coloca nos campos para você revisar.
 * Usa os dados salvos do produto. Nada vai para a loja até clicar em "Salvar na Nuvemshop".
 */
export function SeoIa({ produtoId, jaPreenchido, aoGerar }: { produtoId: string; jaPreenchido: () => boolean; aoGerar: (r: { titulo: string; descricao: string }) => void }) {
  const [rodando, setRodando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  async function gerar() {
    if (jaPreenchido() && !window.confirm("Substituir o título e a descrição de SEO que estão nos campos por novos, escritos pela IA? Nada muda na loja até você clicar em “Salvar na Nuvemshop”.")) return;
    setRodando(true);
    setErro(null);
    setMsg(null);
    setAvisos([]);
    try {
      const s = await sugerirIa(produtoId, ["seo"]);
      if (!s.seoTitulo || !s.seoDescricao) throw new Error("A IA não devolveu o SEO.");
      aoGerar({ titulo: s.seoTitulo, descricao: s.seoDescricao });
      setAvisos(s.avisos);
      setMsg("SEO preenchido. Revise e clique em “Salvar na Nuvemshop” para gravar.");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível escrever o SEO agora.");
    } finally {
      setRodando(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1" role="status" aria-live="polite">
      <Button type="button" variant="outline" className="min-h-8 px-3 py-1" disabled={rodando} onClick={gerar}>
        {rodando ? "Escrevendo… (até 1 min)" : "✨ Preencher SEO com IA"}
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
