"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface Item {
  id: string;
  numero: number | null;
  criadoEm: string;
  total: number;
  valor: number;
  sinais: string[];
  retido: boolean;
}

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
const POR_CHAMADA = 5;

export function Elegiveis({ itens, restante }: { itens: Item[]; restante: number }) {
  const router = useRouter();
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [rodando, setRodando] = useState(false);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [resumo, setResumo] = useState<string | null>(null);

  const livres = itens.filter((i) => !i.retido);
  const soma = itens.filter((i) => marcados.has(i.id)).reduce((s, i) => s + i.valor, 0);
  const estoura = soma > restante;

  function alternar(id: string) {
    setMarcados((m) => {
      const n = new Set(m);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function emitir() {
    const ids = itens.filter((i) => marcados.has(i.id)).map((i) => i.id);
    if (!confirm(`Criar ${ids.length} cupom(ns) na loja, num total de ${brl(soma)}? Os cupons podem ser cancelados depois.`)) return;
    setRodando(true);
    setAvisos([]);
    setResumo(null);
    let ok = 0;
    const problemas: string[] = [];
    for (let i = 0; i < ids.length; i += POR_CHAMADA) {
      const res = await fetch("/api/cashback/emitir", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: ids.slice(i, i + POR_CHAMADA) }) });
      const data = (await res.json().catch(() => ({}))) as { resultados?: Array<{ orderId: string; ok: boolean; erro?: string }>; error?: string };
      if (!res.ok || !data.resultados) {
        problemas.push(data.error ?? "Falha ao emitir.");
        break;
      }
      for (const r of data.resultados) {
        if (r.ok) ok++;
        else problemas.push(`Pedido ${itens.find((x) => x.id === r.orderId)?.numero ?? r.orderId}: ${r.erro}`);
      }
      if (data.resultados.some((r) => !r.ok && /orçamento|permit/i.test(r.erro ?? ""))) break;
    }
    setRodando(false);
    setMarcados(new Set());
    setAvisos(problemas);
    setResumo(`${ok} cupom(ns) criado(s).`);
    router.refresh();
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">Pedidos que podem ganhar cashback</h2>
        <div className="flex gap-2 text-sm">
          <button type="button" className="underline" onClick={() => setMarcados(new Set(livres.map((i) => i.id)))}>
            Marcar todos
          </button>
          <button type="button" className="underline" onClick={() => setMarcados(new Set())}>
            Limpar
          </button>
        </div>
      </div>
      {itens.length === 0 ? (
        <p className="text-sm text-muted">Nenhum pedido elegível agora. Atualize os pedidos, ou ajuste as regras (pedido mínimo, espera).</p>
      ) : (
        <ul className="divide-y divide-border">
          {itens.map((i) => (
            <li key={i.id} className="flex items-start gap-3 py-3">
              <input type="checkbox" className="mt-1" disabled={i.retido || rodando} checked={marcados.has(i.id)} onChange={() => alternar(i.id)} aria-label={`Pedido ${i.numero ?? i.id}`} />
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium">
                  Pedido #{i.numero ?? i.id} <span className="font-normal text-muted">· {dia(i.criadoEm)} · {brl(i.total)}</span>
                </p>
                {i.sinais.length > 0 && (
                  <p className={`text-xs ${i.retido ? "text-danger" : "text-muted"}`}>
                    {i.retido ? "Retido para conferência: " : "Atenção: "}
                    {i.sinais.join("; ")}
                  </p>
                )}
              </div>
              <p className="shrink-0 text-sm font-medium">{i.retido ? "—" : brl(i.valor)}</p>
            </li>
          ))}
        </ul>
      )}
      {marcados.size > 0 && (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <p className="text-sm">
            {marcados.size} {marcados.size === 1 ? "pedido marcado" : "pedidos marcados"}: <strong>{brl(soma)}</strong> em cupons. Restam {brl(restante)} do orçamento do mês.
          </p>
          {estoura && <p className="text-sm text-danger">O total passa do orçamento do mês. Marque menos pedidos ou aumente o orçamento.</p>}
          <div>
            <Button type="button" onClick={emitir} disabled={rodando || estoura}>
              {rodando ? "Criando cupons…" : "Criar cupons na loja"}
            </Button>
          </div>
        </div>
      )}
      {resumo && <p role="status" className="text-sm text-success">{resumo}</p>}
      {avisos.length > 0 && (
        <ul role="alert" className="list-disc pl-5 text-sm text-danger">
          {avisos.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}
