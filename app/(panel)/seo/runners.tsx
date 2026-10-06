"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Gera as sugestões de SEO com o Claude em passos (retomável). `maxProdutos` limita a rodada (para testar com poucos). */
export function GenerateRunner({ produtos, geradas, publicados, comEstoque }: { produtos: number; geradas: number; publicados: boolean; comEstoque: boolean }) {
  const router = useRouter();
  const [rodando, setRodando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const faltam = Math.max(0, produtos - geradas);

  async function rodar(maxProdutos?: number) {
    if (!window.confirm(maxProdutos ? `Gerar o SEO de ${maxProdutos} produtos agora com o Claude? Usa a API da Anthropic (custo por uso). Nada é gravado na loja.` : `Gerar o SEO de ${faltam} produtos com o Claude? Usa a API da Anthropic (custo por uso; a tela mostra a estimativa). Nada é gravado na loja.`)) return;
    setRodando(true);
    setErro(null);
    setMsg(null);
    let total = 0;
    let falhas = 0;
    let tentados: string[] = [];
    try {
      for (let i = 0; i < 2000; i++) {
        const restante = maxProdutos ? maxProdutos - total - falhas : undefined;
        if (restante !== undefined && restante <= 0) break;
        const res = await fetch("/api/seo/step", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ maxProdutos: restante, ignorar: tentados, publicados, comEstoque }) });
        const data = (await res.json()) as { error?: string; geradas?: number; erros?: number; restantes?: boolean; tentados?: string[] };
        if (!res.ok || data.error) throw new Error(data.error ?? "Falha ao gerar o SEO.");
        total += data.geradas ?? 0;
        falhas += data.erros ?? 0;
        tentados = data.tentados ?? tentados;
        setMsg(`${total} produto(s) com SEO gerado${falhas ? `, ${falhas} com erro` : ""}…`);
        if (!data.restantes) break;
      }
      setMsg(`Pronto: ${total} produto(s) com SEO gerado${falhas ? `, ${falhas} com erro (tente de novo em 10 minutos)` : ""}.`);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao gerar o SEO.");
    } finally {
      setRodando(false);
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-2" role="status" aria-live="polite">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={rodando || faltam === 0} onClick={() => rodar(10)}>
          Testar com 10 produtos
        </Button>
        <Button type="button" disabled={rodando || faltam === 0} onClick={() => rodar()}>
          {rodando ? "Gerando… (mantenha a página aberta)" : `Gerar para todos (${faltam} faltando)`}
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

/** Envia as sugestões à loja em passos (retomável). */
export function ApplyRunner({ vazios, todos, publicados, comEstoque }: { vazios: number; todos: number; publicados: boolean; comEstoque: boolean }) {
  const router = useRouter();
  const [rodando, setRodando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function aplicar(modo: "vazios" | "todos") {
    const n = modo === "vazios" ? vazios : todos;
    const texto =
      modo === "vazios"
        ? `Enviar o SEO de ${n} produtos que hoje não têm título nem descrição de SEO na loja?`
        : `Enviar o SEO de ${n} produtos à loja, SUBSTITUINDO o título e a descrição de SEO que já existem (${n - vazios} produtos já têm texto)? O texto antigo fica no Histórico, mas não volta sozinho.`;
    if (!window.confirm(texto)) return;
    setRodando(true);
    setErro(null);
    let aplicados = 0;
    const falhas: string[] = [];
    const ignorar: string[] = [];
    try {
      for (let i = 0; i < 2000; i++) {
        const res = await fetch("/api/seo/apply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ modo, ignorar, publicados, comEstoque }) });
        const data = (await res.json()) as { error?: string; aplicados?: number; falhas?: Array<{ productId: string; produto: string; mensagem: string }>; restantes?: boolean };
        if (!res.ok || data.error) throw new Error(data.error ?? "Falha ao enviar o SEO.");
        aplicados += data.aplicados ?? 0;
        for (const f of data.falhas ?? []) {
          ignorar.push(f.productId);
          falhas.push(`${f.produto}: ${f.mensagem}`);
        }
        setMsg(`${aplicados} produto(s) enviado(s)…`);
        if (!data.restantes) break;
      }
      setMsg(`Pronto: ${aplicados} produto(s) com SEO gravado na loja.${falhas.length ? ` Com erro: ${falhas.slice(0, 5).join(" · ")}${falhas.length > 5 ? ` e mais ${falhas.length - 5}` : ""}` : ""}`);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao enviar o SEO.");
    } finally {
      setRodando(false);
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-2" role="status" aria-live="polite">
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={rodando || vazios === 0} onClick={() => aplicar("vazios")}>
          {rodando ? "Enviando…" : `Enviar nos que estão sem SEO (${vazios})`}
        </Button>
        <Button type="button" variant="outline" disabled={rodando || todos === 0} onClick={() => aplicar("todos")}>
          Enviar em todos, substituindo o que existe ({todos})
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
