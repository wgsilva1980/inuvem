"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { fieldClass } from "@/components/ui/field";

const num = (v: string): number | null => {
  const s = v.trim().replace(/\s/g, "").replace(/^R\$/i, "");
  if (s === "") return null;
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? n : NaN;
};

/** Formulário de criação em lote: 1) gerar os códigos (nada vai à loja) 2) criar na loja em pedaços de 10, com tentativa de novo para os que falharem. */
export function CuponsLote() {
  const router = useRouter();
  const [f, setF] = useState({ prefixo: "", quantidade: "10", tipo: "percentual", valor: "10", inicio: "", fim: "", usos: "1", minimo: "", primeira: false, combina: false });
  const [codigos, setCodigos] = useState<string[] | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [progresso, setProgresso] = useState<string | null>(null);
  const [falhas, setFalhas] = useState<Array<{ code: string; error: string }>>([]);
  const [pendentes, setPendentes] = useState<string[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<{ prefixo: string; criados: number } | null>(null);

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => {
    setF((s) => ({ ...s, [k]: v }));
    setCodigos(null);
    setFeito(null);
  };

  function lote() {
    const quantidade = Number(f.quantidade);
    const valor = num(f.valor);
    const usos = num(f.usos);
    const minimo = num(f.minimo);
    if (!Number.isInteger(quantidade)) throw new Error("Informe a quantidade de códigos.");
    if (valor === null || Number.isNaN(valor)) throw new Error("Informe o valor do desconto.");
    if (Number.isNaN(usos as number) || Number.isNaN(minimo as number)) throw new Error("Confira os números digitados.");
    return {
      prefixo: f.prefixo,
      quantidade,
      tipo: f.tipo,
      valor,
      inicio: f.inicio || null,
      fim: f.fim || null,
      usosPorCupom: usos,
      minimo,
      primeiraCompra: f.primeira,
      combina: f.combina,
    };
  }

  async function gerar() {
    setErro(null);
    setFeito(null);
    setFalhas([]);
    setOcupado(true);
    try {
      const res = await fetch("/api/cupons/preparar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(lote()) });
      const d = (await res.json()) as { error?: string; codigos?: string[]; aviso?: string | null };
      if (!res.ok || d.error) throw new Error(d.error ?? "Falha ao gerar os códigos.");
      setCodigos(d.codigos ?? []);
      setPendentes(d.codigos ?? []);
      setAviso(d.aviso ?? null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao gerar os códigos.");
    } finally {
      setOcupado(false);
    }
  }

  async function criar(alvo: string[]) {
    setErro(null);
    setFalhas([]);
    setOcupado(true);
    let criados = 0;
    const falhou: Array<{ code: string; error: string }> = [];
    const restantes: string[] = [];
    try {
      const corpo = lote();
      for (let i = 0; i < alvo.length; i += 10) {
        const parte = alvo.slice(i, i + 10);
        setProgresso(`Criando… ${criados} de ${alvo.length}`);
        const res = await fetch("/api/cupons/criar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lote: corpo, codigos: parte }) });
        const d = (await res.json()) as { error?: string; resultados?: Array<{ code: string; ok: boolean; error?: string }> };
        if (!res.ok || d.error) throw new Error(d.error ?? "Falha ao criar os cupons.");
        const vistos = new Set<string>();
        for (const r of d.resultados ?? []) {
          vistos.add(r.code);
          if (r.ok) criados++;
          else {
            falhou.push({ code: r.code, error: r.error ?? "Falha." });
            restantes.push(r.code);
          }
        }
        for (const c of parte) if (!vistos.has(c)) restantes.push(c); // a chamada parou antes (ex.: sem permissão)
        if ((d.resultados ?? []).length < new Set(parte).size) {
          restantes.push(...alvo.slice(i + 10));
          break;
        }
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao criar os cupons.");
    } finally {
      setOcupado(false);
      setProgresso(null);
      setFalhas(falhou);
      setPendentes([...new Set(restantes)]);
      setFeito((a) => ({ prefixo: f.prefixo, criados: (a?.criados ?? 0) + criados }));
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-medium">Criar cupons em lote</h2>
        <p className="text-sm text-muted">Todos com as mesmas regras e um código diferente cada (prefixo + 6 caracteres, por exemplo VERAOK7M2QX).</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Prefixo do código</span>
          <input value={f.prefixo} onChange={(e) => set("prefixo", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} maxLength={12} placeholder="VERAO" className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Quantidade de códigos (até 200)</span>
          <input value={f.quantidade} onChange={(e) => set("quantidade", e.target.value)} inputMode="numeric" className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Usos por código (vazio = sem limite)</span>
          <input value={f.usos} onChange={(e) => set("usos", e.target.value)} inputMode="numeric" className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Tipo de desconto</span>
          <select value={f.tipo} onChange={(e) => set("tipo", e.target.value)} className={fieldClass}>
            <option value="percentual">Percentual (%)</option>
            <option value="valor">Valor fixo (R$)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{f.tipo === "percentual" ? "Desconto (%)" : "Desconto (R$)"}</span>
          <input value={f.valor} onChange={(e) => set("valor", e.target.value)} inputMode="decimal" className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Pedido mínimo (R$, opcional)</span>
          <input value={f.minimo} onChange={(e) => set("minimo", e.target.value)} inputMode="decimal" className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Válido a partir de (opcional)</span>
          <input type="date" value={f.inicio} onChange={(e) => set("inicio", e.target.value)} className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Válido até (opcional)</span>
          <input type="date" value={f.fim} onChange={(e) => set("fim", e.target.value)} className={fieldClass} />
        </label>
        <div className="flex flex-col justify-end gap-1 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" className="size-5" checked={f.primeira} onChange={(e) => set("primeira", e.target.checked)} />
            Só na primeira compra do cliente
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="size-5" checked={f.combina} onChange={(e) => set("combina", e.target.checked)} />
            Pode somar com outros descontos
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="status" aria-live="polite">
        <Button type="button" variant={codigos ? "outline" : "primary"} disabled={ocupado || f.prefixo.length < 2} onClick={gerar}>
          {codigos ? "Sortear outros códigos" : "Gerar os códigos"}
        </Button>
        {codigos && (
          <Button type="button" disabled={ocupado || pendentes.length === 0} onClick={() => criar(pendentes)}>
            {ocupado ? (progresso ?? "Criando…") : `Criar ${pendentes.length} cupom(ns) na loja`}
          </Button>
        )}
        {feito && !ocupado && feito.criados > 0 && (
          <a className={buttonClass("outline")} href={`/api/cupons/exportar?prefixo=${encodeURIComponent(feito.prefixo)}`} download>
            Baixar Excel do prefixo {feito.prefixo}
          </a>
        )}
      </div>

      {codigos && (
        <p className="text-sm text-muted">
          {codigos.length} código(s) gerados, ainda não criados na loja: {codigos.slice(0, 5).join(", ")}
          {codigos.length > 5 ? "…" : ""}.{aviso ? ` ${aviso}` : ""}
        </p>
      )}
      {feito && !ocupado && (
        <p className="text-sm">
          {feito.criados} cupom(ns) criado(s) na loja.{falhas.length ? ` ${falhas.length} falharam e continuam na fila: use o botão para tentar de novo.` : ""}
        </p>
      )}
      {falhas.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-danger">
          {falhas.slice(0, 8).map((x) => (
            <li key={x.code}>
              <span className="font-mono">{x.code}</span>: {x.error}
            </li>
          ))}
        </ul>
      )}
      {erro && (
        <p role="alert" className="text-sm text-danger">
          {erro}
        </p>
      )}
    </div>
  );
}
