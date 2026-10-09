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
  campos: string[];
  inicio: string;
  incremental: boolean;
  novos: number;
  atualizados: number;
  vinculados: number;
  preenchidos: number;
  criados: number;
}

/** Traz os clientes da loja para os Contatos, em passos (a página precisa ficar aberta). Só lê da loja. */
export function SincronizarClientes({ ultima }: { ultima: string | null }) {
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
    const t = { lidos: 0, novos: 0, vinculados: 0, criados: 0, preenchidos: 0, invalidos: 0 };
    let campos: string[] = [];
    let incremental = false;
    try {
      for (let i = 0; i < 500; i++) {
        const res = await fetch("/api/clientes/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ page, completo, inicio }) });
        const d = (await res.json()) as Passo;
        if (!res.ok || d.error) throw new Error(d.error ?? "Falha ao sincronizar os clientes.");
        t.lidos += d.lidos;
        t.novos += d.novos;
        t.vinculados += d.vinculados;
        t.criados += d.criados;
        t.preenchidos += d.preenchidos;
        t.invalidos += d.invalidos;
        if (d.campos.length) campos = d.campos;
        incremental = d.incremental;
        inicio = d.inicio;
        setMsg(`${t.lidos} cliente(s) lidos…`);
        if (d.concluido || d.proxima === null) break;
        page = d.proxima;
      }
      setMsg(
        `Pronto${incremental ? " (só os alterados desde a última vez)" : ""}: ${t.lidos} cliente(s) lidos, ${t.novos} novo(s) no espelho, ${t.criados} contato(s) criado(s), ${t.vinculados} contato(s) já existente(s) ligado(s), ${t.preenchidos} contato(s) com dados em branco preenchidos.${t.invalidos ? ` ${t.invalidos} registro(s) ignorado(s) por formato inesperado.` : ""}${campos.length ? ` Campos recebidos da loja: ${campos.join(", ")}.` : ""}`,
      );
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao sincronizar os clientes.");
    } finally {
      setRodando(false);
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-2" role="status" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" disabled={rodando} onClick={() => rodar(false)}>
          {rodando ? "Sincronizando… (mantenha a página aberta)" : ultima ? "Atualizar clientes da loja" : "Trazer clientes da loja"}
        </Button>
        {ultima && !rodando && (
          <Button type="button" variant="outline" onClick={() => rodar(true)}>
            Reler todos
          </Button>
        )}
        <span className="text-xs text-muted">{ultima ? `Última sincronização: ${new Date(ultima).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : "Ainda não sincronizado."}</span>
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
