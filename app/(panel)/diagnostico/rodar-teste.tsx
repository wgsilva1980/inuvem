"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ROTULO_STATUS, relatorioTexto, type Diagnostico, type StatusSonda } from "@/lib/diagnostico/relatorio";

const TOM: Record<StatusSonda, "success" | "warning" | "danger" | "neutral"> = { ok: "success", aviso: "danger", sem_dados: "neutral", sem_permissao: "danger", indisponivel: "warning", erro: "danger" };

export function RodarTeste() {
  const [rodando, setRodando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [d, setD] = useState<Diagnostico | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);

  async function rodar() {
    setRodando(true);
    setErro(null);
    setCopiado(null);
    try {
      const res = await fetch("/api/diagnostico", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as Diagnostico & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Não foi possível rodar o teste.");
      setD(data);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao rodar o teste.");
    } finally {
      setRodando(false);
    }
  }

  async function copiar() {
    if (!d) return;
    try {
      await navigator.clipboard.writeText(relatorioTexto(d));
      setCopiado("Relatório copiado. Pode colar na conversa.");
    } catch {
      setCopiado("Não consegui copiar; selecione o texto e copie à mão.");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={rodar} disabled={rodando}>
            {rodando ? "Testando a API… (até 30 s)" : d ? "Rodar o teste de novo" : "Rodar o teste"}
          </Button>
          {d && (
            <Button type="button" variant="outline" onClick={copiar}>
              Copiar relatório
            </Button>
          )}
        </div>
        <p className="text-xs text-muted">Faz cerca de 10 leituras (GET) na Nuvemshop. Não altera nada na loja e o relatório traz só nomes de campos, nunca valores nem dados de clientes.</p>
        {copiado && <p role="status" className="text-xs text-muted">{copiado}</p>}
        {erro && <p role="alert" className="text-sm text-danger">{erro}</p>}
      </Card>

      {d && (
        <>
          <p className="text-xs text-muted">Teste feito em {new Date(d.geradoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} ({Math.round(d.duracaoMs / 100) / 10} s).</p>
          {d.sondas.map((s) => (
            <Card key={s.id} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium">
                  {s.titulo} <span className="font-mono text-xs font-normal text-muted">GET {s.caminho}</span>
                </h3>
                <Badge tone={TOM[s.status]}>{ROTULO_STATUS[s.status]}</Badge>
              </div>
              <p className="text-sm">{s.mensagem}</p>
              <p className="text-xs text-muted">
                Usado por: {s.usadoPor}
                {s.itensLidos > 0 ? ` · ${s.itensLidos} item(ns) lido(s) · ${s.ms} ms` : ""}
              </p>
              {s.campos.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted">Campo a campo ({s.campos.filter((c) => c.presente).length} de {s.campos.length} presentes)</summary>
                  <table className="mt-2 w-full text-left text-xs">
                    <thead>
                      <tr className="text-muted">
                        <th className="py-1 pr-3 font-medium">Campo</th>
                        <th className="py-1 pr-3 font-medium">Situação</th>
                        <th className="py-1 pr-3 font-medium">Tipo</th>
                        <th className="py-1 font-medium">Para que serve</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.campos.map((c) => (
                        <tr key={c.caminho} className="border-t border-border align-top">
                          <td className="py-1 pr-3 font-mono">{c.caminho}</td>
                          <td className={`py-1 pr-3 ${c.presente ? "text-success" : c.obrigatorio ? "text-danger" : "text-muted"}`}>{c.presente ? "veio" : c.obrigatorio ? "FALTOU" : "não veio (opcional)"}</td>
                          <td className="py-1 pr-3">{c.tipo ?? "—"}</td>
                          <td className="py-1">{c.uso}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {s.status !== "ok" && s.recebidos.length > 0 && <p className="mt-2 text-xs text-muted">Campos que a loja devolveu: {s.recebidos.join(", ")}</p>}
                </details>
              )}
            </Card>
          ))}
          <Card className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium">Webhooks (avisos da loja)</h3>
              <Badge tone={d.webhooks.status === "ok" ? "success" : d.webhooks.status === "aviso" ? "warning" : "danger"}>{d.webhooks.status === "ok" ? "OK" : d.webhooks.status === "aviso" ? "Faltam avisos" : "Erro"}</Badge>
            </div>
            <p className="text-sm">{d.webhooks.mensagem}</p>
            {d.webhooks.registrados.length > 0 && <p className="text-xs text-muted">Registrados: {d.webhooks.registrados.join(", ")}</p>}
          </Card>
        </>
      )}
    </div>
  );
}
