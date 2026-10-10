"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { fieldBase } from "@/components/ui/field";
import { margemPercent } from "@/lib/costs/math";
import type { LinhaCusto } from "@/lib/costs/repo";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const ORIGEM = { manual: "digitado", planilha: "planilha", loja: "da loja" } as const;

/** "12,50", "R$ 1.234,56", "12.5" -> número; vazio -> null; inválido -> "invalido". */
function lerValor(txt: string): number | null | "invalido" {
  let s = txt.trim().replace(/^R\$\s*/i, "").replace(/\s/g, "");
  if (s === "") return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,4})?$/.test(s)) return "invalido";
  return Math.round(Number(s) * 100) / 100;
}

function Linha({ l, margemMinima }: { l: LinhaCusto; margemMinima: number }) {
  const [valor, setValor] = useState(l.custo === null ? "" : l.custo.toFixed(2).replace(".", ","));
  const [salvo, setSalvo] = useState<number | null>(l.custo);
  const [estado, setEstado] = useState<"" | "salvando" | "salvo" | "erro">("");
  const [msg, setMsg] = useState<string | null>(null);

  async function salvar() {
    const novo = lerValor(valor);
    if (novo === "invalido") {
      setEstado("erro");
      setMsg("Digite um número, por exemplo 49,90.");
      return;
    }
    if (novo === salvo) return;
    setEstado("salvando");
    setMsg(null);
    const res = await fetch("/api/custos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ itens: [{ id: l.id, custo: novo }] }) });
    if (!res.ok) {
      setEstado("erro");
      setMsg(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Não foi possível salvar.");
      return;
    }
    setSalvo(novo);
    setEstado("salvo");
    if (novo !== null) setValor(novo.toFixed(2).replace(".", ","));
  }

  const margem = l.preco !== null && salvo !== null ? margemPercent(l.preco, salvo) : null;
  const tom = margem === null ? "neutral" : margem < 0 ? "danger" : margem < margemMinima ? "warning" : "success";

  return (
    <tr className="border-t border-border align-top">
      <td className="py-2 pr-3">
        <Link href={`/produtos/${l.id}`} className="font-medium hover:underline">
          {l.nome}
        </Link>
        {!l.publicado && (
          <>
            {" "}
            <Badge>Não publicado</Badge>
          </>
        )}
        {l.sku && <span className="block text-xs text-muted">{l.sku}</span>}
      </td>
      <td className="py-2 pr-3 text-right">{l.preco === null ? "—" : brl(l.preco)}</td>
      <td className="py-2 pr-3">
        <input
          inputMode="decimal"
          aria-label={`Custo de ${l.nome}`}
          value={valor}
          placeholder="—"
          onChange={(e) => {
            setValor(e.target.value);
            setEstado("");
          }}
          onBlur={salvar}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className={`${fieldBase} w-28 text-right`}
        />
        <span className="mt-0.5 block text-xs text-muted" aria-live="polite">
          {estado === "salvando" ? "Salvando…" : estado === "salvo" ? "Salvo" : estado === "erro" ? <span className="text-danger">{msg}</span> : salvo !== null && l.origem ? ORIGEM[l.origem] : ""}
        </span>
      </td>
      <td className="py-2 text-right">{margem === null ? <span className="text-muted">—</span> : <Badge tone={tom}>{margem.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</Badge>}</td>
    </tr>
  );
}

export function TabelaCustos({ linhas, margemMinima }: { linhas: LinhaCusto[]; margemMinima: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-xs text-muted">
            <th className="py-1 pr-3 font-medium">Produto</th>
            <th className="py-1 pr-3 text-right font-medium">Preço de venda</th>
            <th className="py-1 pr-3 font-medium">Custo (R$)</th>
            <th className="py-1 text-right font-medium">Margem</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <Linha key={`${l.id}:${l.custo}`} l={l} margemMinima={margemMinima} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
