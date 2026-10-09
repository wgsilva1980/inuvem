"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

interface Passo {
  error?: string;
  proxima: number | null;
  concluido: boolean;
  lidos: number;
  invalidos: number;
  ignorados: number;
  campos: string[];
  inicio: string;
  incremental: boolean;
  novos: number;
  atualizados: number;
}

/** Traz os pedidos da loja (só leitura), em passos; a página precisa ficar aberta. Alimenta o painel de vendas e a liquidação. */
export function SincronizarPedidos({ ultima }: { ultima: string | null }) {
  const router = useRouter();
  const [rodando, setRodando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function rodar(completo: boolean) {
    setRodando(true);
    setErro(null);
    setMsg(null);
    let page: number | undefined;
    let inicio: string | undefined;
    const t = { lidos: 0, novos: 0, atualizados: 0, invalidos: 0, ignorados: 0 };
    let campos: string[] = [];
    let incremental = false;
    try {
      for (let i = 0; i < 1000; i++) {
        const res = await fetch("/api/pedidos/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ page, completo, inicio }) });
        const d = (await res.json()) as Passo;
        if (!res.ok || d.error) throw new Error(d.error ?? "Falha ao ler os pedidos.");
        t.lidos += d.lidos;
        t.novos += d.novos;
        t.atualizados += d.atualizados;
        t.invalidos += d.invalidos;
        t.ignorados += d.ignorados;
        if (d.campos.length) campos = d.campos;
        incremental = d.incremental;
        inicio = d.inicio;
        setMsg(`${t.lidos} pedido(s) lidos…`);
        if (d.concluido || d.proxima === null) break;
        page = d.proxima;
      }
      setMsg(
        `Pronto${incremental ? " (só os alterados desde a última vez)" : ""}: ${t.lidos} pedido(s) lidos, ${t.novos} novo(s), ${t.atualizados} atualizado(s).${t.invalidos + t.ignorados ? ` ${t.invalidos + t.ignorados} ignorado(s) por formato inesperado.` : ""}${t.lidos === 0 && !incremental ? " Nenhum pedido encontrado: confira se a loja tem vendas no período." : ""}${campos.length ? ` Campos recebidos: ${campos.join(", ")}.` : ""}`,
      );
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao ler os pedidos.");
    } finally {
      setRodando(false);
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-2" role="status" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant={ultima ? "outline" : "primary"} disabled={rodando} onClick={() => rodar(false)}>
          {rodando ? "Lendo os pedidos… (mantenha a página aberta)" : ultima ? "Atualizar pedidos da loja" : "Ler os pedidos da loja"}
        </Button>
        {ultima && !rodando && (
          <Button type="button" variant="outline" onClick={() => rodar(true)}>
            Reler tudo
          </Button>
        )}
        <span className="text-xs text-muted">{ultima ? `Última leitura: ${new Date(ultima).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : "Os pedidos ainda não foram lidos."}</span>
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
