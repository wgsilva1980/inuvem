"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SITUACAO_LABEL, type SituacaoCupom } from "@/lib/coupons/lote";

export interface LinhaCupom {
  id: number;
  code: string;
  tipo: string;
  valor: string;
  situacao: SituacaoCupom;
  usos: number;
  limite: number | null;
  inicio: string | null;
  fim: string | null;
}

const TOM: Record<SituacaoCupom, "success" | "neutral" | "warning" | "danger"> = { ativo: "success", agendado: "neutral", inativo: "neutral", vencido: "warning", esgotado: "warning" };
const dataBr = (d: string | null) => (d ? d.split("-").reverse().join("/") : "");

export function CuponsLista({ linhas, total }: { linhas: LinhaCupom[]; total: number }) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [rodando, setRodando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const desativaveis = linhas.filter((l) => l.situacao !== "inativo");

  async function desativar() {
    const alvo = linhas.filter((l) => sel.has(l.id));
    if (alvo.length === 0) return;
    if (!window.confirm(`Desativar ${alvo.length} cupom(ns)? Eles deixam de valer na loja agora; dá para reativar depois na própria loja.`)) return;
    setRodando(true);
    setErro(null);
    setMsg(null);
    let ok = 0;
    const falhas: string[] = [];
    try {
      for (let i = 0; i < alvo.length; i += 20) {
        const parte = alvo.slice(i, i + 20);
        const res = await fetch("/api/cupons/desativar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cupons: parte.map((l) => ({ id: l.id, code: l.code })) }) });
        const d = (await res.json()) as { error?: string; resultados?: Array<{ id: number; ok: boolean; error?: string }> };
        if (!res.ok || d.error) throw new Error(d.error ?? "Falha ao desativar.");
        for (const r of d.resultados ?? []) {
          if (r.ok) ok++;
          else falhas.push(`${alvo.find((l) => l.id === r.id)?.code ?? r.id}: ${r.error}`);
        }
        if ((d.resultados ?? []).length < parte.length) break;
      }
      setMsg(`${ok} cupom(ns) desativado(s).${falhas.length ? ` Com erro: ${falhas.slice(0, 5).join(" · ")}` : ""}`);
      setSel(new Set());
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao desativar.");
    } finally {
      setRodando(false);
      router.refresh();
    }
  }

  if (linhas.length === 0) return <p className="p-6 text-sm text-muted">{total === 0 ? "A loja ainda não tem cupons." : "Nenhum cupom com esses filtros."}</p>;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-3 text-sm">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            className="size-5"
            checked={desativaveis.length > 0 && desativaveis.every((l) => sel.has(l.id))}
            onChange={(e) => setSel(e.target.checked ? new Set(desativaveis.map((l) => l.id)) : new Set())}
            aria-label="Selecionar todos os cupons desta lista que ainda valem"
          />
          Selecionar os que ainda valem
        </label>
        <Button type="button" variant="outline" disabled={rodando || sel.size === 0} onClick={desativar}>
          {rodando ? "Desativando…" : `Desativar selecionados (${sel.size})`}
        </Button>
        <span className="text-muted">
          {linhas.length} de {total} cupons
        </span>
      </div>
      {(msg || erro) && (
        <p role={erro ? "alert" : "status"} className={`px-4 pt-3 text-sm ${erro ? "text-danger" : ""}`}>
          {erro ?? msg}
        </p>
      )}
      <ul className="divide-y divide-border">
        {linhas.map((l) => (
          <li key={l.id} className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:gap-4">
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
              <input type="checkbox" className="size-5" disabled={l.situacao === "inativo"} checked={sel.has(l.id)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n; })} aria-label={`Selecionar ${l.code}`} />
              <span className="min-w-0">
                <span className="block truncate font-mono font-medium">{l.code}</span>
                <span className="block text-xs text-muted">
                  {l.tipo === "%" ? `${l.valor}% de desconto` : l.tipo === "R$" ? `R$ ${l.valor} de desconto` : "Desconto"} · {l.usos}
                  {l.limite !== null ? `/${l.limite}` : ""} {l.usos === 1 && l.limite === null ? "uso" : "usos"}
                  {l.inicio || l.fim ? ` · válido ${l.inicio ? `de ${dataBr(l.inicio)} ` : ""}${l.fim ? `até ${dataBr(l.fim)}` : ""}` : ""}
                </span>
              </span>
            </label>
            <Badge tone={TOM[l.situacao]}>{SITUACAO_LABEL[l.situacao]}</Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}
