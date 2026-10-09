"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { TipoItem } from "@/lib/seo/item-generate";

const NOME: Record<TipoItem, string> = { categoria: "categorias", pagina: "páginas" };

async function chamar<T>(url: string, corpo: unknown): Promise<T & { error?: string }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
  const d = (await res.json()) as T & { error?: string };
  if (!res.ok || d.error) throw new Error(d.error ?? "Falha na chamada.");
  return d;
}

/** Gera as sugestões (Claude) e grava na loja, em pedaços. A página precisa ficar aberta; dá para recomeçar de onde parou. */
export function ItensRunners({ tipo, idsGerar, idsTodos, idsGravar, idsGravarVazios }: { tipo: TipoItem; idsGerar: string[]; idsTodos: string[]; idsGravar: string[]; idsGravarVazios: string[] }) {
  const router = useRouter();
  const [rodando, setRodando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function gerar(ids: string[], aviso: string) {
    if (!window.confirm(aviso)) return;
    setRodando(true);
    setErro(null);
    setMsg(null);
    let geradas = 0;
    let erros = 0;
    try {
      for (let i = 0; i < ids.length; i += 6) {
        const r = await chamar<{ geradas: number; erros: number }>("/api/seo-itens/gerar", { tipo, ids: ids.slice(i, i + 6) });
        geradas += r.geradas;
        erros += r.erros;
        setMsg(`${geradas} de ${ids.length} com SEO gerado${erros ? `, ${erros} com erro` : ""}…`);
      }
      setMsg(`Pronto: ${geradas} com SEO gerado${erros ? `, ${erros} com erro (gere de novo depois)` : ""}.`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao gerar o SEO.");
    } finally {
      setRodando(false);
      router.refresh();
    }
  }

  async function gravar(ids: string[], modo: "vazios" | "todos") {
    if (!window.confirm(`Gravar o SEO sugerido em ${ids.length} ${NOME[tipo]} na loja${modo === "todos" ? ", substituindo o SEO que já existe" : " (só onde está vazio)"}? Cada item vai para o Histórico com o texto antigo.`)) return;
    setRodando(true);
    setErro(null);
    setMsg(null);
    let ok = 0;
    let pulados = 0;
    const falhas: string[] = [];
    try {
      for (let i = 0; i < ids.length; i += 8) {
        const parte = ids.slice(i, i + 8);
        const r = await chamar<{ resultados: Array<{ id: string; ok: boolean; pulado?: boolean; erro?: string }> }>("/api/seo-itens/aplicar", { tipo, ids: parte, modo });
        for (const x of r.resultados) {
          if (x.ok && x.pulado) pulados++;
          else if (x.ok) ok++;
          else falhas.push(x.erro ?? "Falha.");
        }
        setMsg(`${ok} gravado(s)…`);
        if (r.resultados.length < parte.length) break;
      }
      setMsg(`Pronto: ${ok} gravado(s)${pulados ? `, ${pulados} pulado(s) por já terem SEO` : ""}.${falhas.length ? ` Com erro: ${[...new Set(falhas)].slice(0, 3).join(" · ")}` : ""}`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao gravar o SEO.");
    } finally {
      setRodando(false);
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-2" role="status" aria-live="polite">
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={rodando || idsGerar.length === 0} onClick={() => gerar(idsGerar, `Gerar o SEO de ${idsGerar.length} ${NOME[tipo]} com o Claude? Usa a API da Anthropic (custo por uso). Nada é gravado na loja.`)}>
          {rodando ? "Trabalhando… (mantenha a página aberta)" : `Gerar para quem falta (${idsGerar.length})`}
        </Button>
        <Button type="button" variant="outline" disabled={rodando || idsTodos.length === 0} onClick={() => gerar(idsTodos, `Gerar de novo o SEO de TODAS as ${idsTodos.length} ${NOME[tipo]}, trocando as sugestões atuais? Usa a API da Anthropic (custo por uso). Nada é gravado na loja.`)}>
          Gerar tudo de novo
        </Button>
        <Button type="button" variant="outline" disabled={rodando || idsGravarVazios.length === 0} onClick={() => gravar(idsGravarVazios, "vazios")}>
          Gravar nas que estão sem SEO ({idsGravarVazios.length})
        </Button>
        <Button type="button" variant="outline" disabled={rodando || idsGravar.length === 0} onClick={() => gravar(idsGravar, "todos")}>
          Gravar em todas ({idsGravar.length})
        </Button>
      </div>
      {msg && <p className="text-sm">{msg}</p>}
      {erro && (
        <p role="alert" className="text-sm text-danger">
          {erro}
        </p>
      )}
    </div>
  );
}
