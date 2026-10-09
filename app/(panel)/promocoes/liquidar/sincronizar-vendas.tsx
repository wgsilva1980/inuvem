"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

interface Passo {
  error?: string;
  proxima: number | null;
  concluido: boolean;
  runId: string;
  lidos: number;
  invalidos: number;
  campos: string[];
  produtos: number;
}

/** Lê os pedidos pagos da loja (só leitura), em passos, para saber o que vende. A página precisa ficar aberta. */
export function SincronizarVendas({ ultima, janelaDias }: { ultima: string | null; janelaDias: number | null }) {
  const router = useRouter();
  const [rodando, setRodando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function rodar() {
    setRodando(true);
    setErro(null);
    setMsg(null);
    let page: number | undefined;
    let runId: string | undefined;
    let lidos = 0;
    let invalidos = 0;
    let campos: string[] = [];
    try {
      for (let i = 0; i < 1000; i++) {
        const res = await fetch("/api/vendas/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ page, runId }) });
        const d = (await res.json()) as Passo;
        if (!res.ok || d.error) throw new Error(d.error ?? "Falha ao ler as vendas.");
        lidos += d.lidos;
        invalidos += d.invalidos;
        runId = d.runId;
        if (d.campos.length) campos = d.campos;
        setMsg(`${lidos} pedido(s) lidos…`);
        if (d.concluido || d.proxima === null) break;
        page = d.proxima;
      }
      setMsg(`Pronto: ${lidos} pedido(s) pagos lidos.${invalidos ? ` ${invalidos} ignorado(s) por formato inesperado.` : ""}${lidos === 0 ? " Nenhum pedido encontrado: confira se a loja tem vendas no período." : ""}${campos.length ? ` Campos recebidos: ${campos.join(", ")}.` : ""}`);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao ler as vendas.");
    } finally {
      setRodando(false);
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-2" role="status" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant={ultima ? "outline" : "primary"} disabled={rodando} onClick={rodar}>
          {rodando ? "Lendo as vendas… (mantenha a página aberta)" : ultima ? "Atualizar vendas da loja" : "Ler as vendas da loja"}
        </Button>
        <span className="text-xs text-muted">
          {ultima ? `Última leitura: ${new Date(ultima).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} (pedidos pagos dos últimos ${janelaDias} dias)` : "As vendas ainda não foram lidas."}
        </span>
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
