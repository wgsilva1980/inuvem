"use client";

import { useActionState, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass } from "@/components/ui/field";
import { criarLiquidacao, type PromoFormState } from "../actions";

export interface LinhaParada {
  id: string;
  name: string;
  published: boolean;
  estoque: number;
  precoMin: number;
  precoMax: number;
  jaEmPromocao: boolean;
  vendidas: number;
  diasParado: number;
  nuncaVendeu: boolean;
  valorParado: number;
  base: number;
}

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function LiquidarForm({ linhas, filtros }: { linhas: LinhaParada[]; filtros: { dias: number; minEstoque: number; apenasPublicados: boolean } }) {
  const [state, action, pending] = useActionState<PromoFormState | null, FormData>(criarLiquidacao, null);
  const [marcados, setMarcados] = useState<Set<string>>(() => new Set(linhas.map((l) => l.id)));
  const [percent, setPercent] = useState<Record<string, string>>(() => Object.fromEntries(linhas.map((l) => [l.id, String(l.base)])));
  const [motivo, setMotivo] = useState<Record<string, string>>({});
  const [sugerindo, setSugerindo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const escolhidas = linhas.filter((l) => marcados.has(l.id));
  const payload = useMemo(
    () =>
      JSON.stringify(
        escolhidas.map((l) => ({ id: l.id, percent: Number(String(percent[l.id] ?? "").replace(",", ".")) })).filter((x) => Number.isFinite(x.percent) && x.percent > 0 && x.percent < 100),
      ),
    [escolhidas, percent],
  );

  function alternar(id: string) {
    setMarcados((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function sugerir() {
    setSugerindo(true);
    setErro(null);
    setAviso(null);
    try {
      const ids = escolhidas.slice(0, 100).map((l) => l.id);
      const res = await fetch("/api/promocoes/liquidar/sugestoes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids, dias: filtros.dias, minEstoque: filtros.minEstoque, apenasPublicados: filtros.apenasPublicados }),
      });
      const d = (await res.json()) as { error?: string; ia?: boolean; aviso?: string; sugestoes?: Array<{ id: string; percent: number; motivo: string }> };
      if (!res.ok || d.error) throw new Error(d.error ?? "Falha ao pedir as sugestões.");
      setPercent((p) => ({ ...p, ...Object.fromEntries((d.sugestoes ?? []).map((s) => [s.id, String(s.percent)])) }));
      setMotivo((m) => ({ ...m, ...Object.fromEntries((d.sugestoes ?? []).map((s) => [s.id, s.motivo])) }));
      setAviso(d.ia ? (escolhidas.length > 100 ? "As 100 primeiras marcadas foram analisadas; as demais ficam com o desconto padrão." : null) : (d.aviso ?? "Usei a regra por tempo parado."));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao pedir as sugestões.");
    } finally {
      setSugerindo(false);
    }
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="linhas" value={payload} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" disabled={sugerindo || escolhidas.length === 0} onClick={sugerir}>
          {sugerindo ? "Pedindo ao Claude…" : "Sugerir descontos com a IA"}
        </Button>
        <button type="button" className="text-sm underline" onClick={() => setMarcados(new Set(linhas.map((l) => l.id)))}>
          Marcar todos
        </button>
        <button type="button" className="text-sm underline" onClick={() => setMarcados(new Set())}>
          Desmarcar todos
        </button>
        <span className="text-sm text-muted">
          {escolhidas.length} de {linhas.length} marcados
        </span>
      </div>
      {aviso && <p className="text-sm text-muted">{aviso}</p>}
      {erro && (
        <p role="alert" className="text-sm text-danger">
          {erro}
        </p>
      )}

      <ul className="divide-y divide-border rounded-md border border-border">
        {linhas.map((l) => (
          <li key={l.id} className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:gap-4">
            <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
              <input type="checkbox" className="mt-1 size-5" checked={marcados.has(l.id)} onChange={() => alternar(l.id)} />
              <span className="min-w-0">
                <span className="block truncate font-medium">{l.name}</span>
                <span className="block text-xs text-muted">
                  {l.nuncaVendeu ? `Sem vendas na janela lida (${l.diasParado} dias)` : `Sem vender há ${l.diasParado} dias`} · {l.estoque} un. em estoque · {brl(l.precoMin)}
                  {l.precoMax !== l.precoMin ? ` a ${brl(l.precoMax)}` : ""} · {brl(l.valorParado)} parados{l.jaEmPromocao ? " · já tem preço promocional" : ""}
                  {!l.published ? " · não publicado" : ""}
                </span>
                {motivo[l.id] && <span className="block text-xs">{motivo[l.id]}</span>}
              </span>
            </label>
            <label className="flex shrink-0 items-center gap-2 text-sm">
              <span className="text-muted">Desconto</span>
              <input
                inputMode="decimal"
                aria-label={`Desconto em % para ${l.name}`}
                value={percent[l.id] ?? ""}
                onChange={(e) => setPercent((p) => ({ ...p, [l.id]: e.target.value }))}
                className={`${fieldClass} w-20`}
              />
              <span>%</span>
            </label>
          </li>
        ))}
      </ul>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="font-medium">Nome da promoção</span>
          <input name="nome" required maxLength={120} defaultValue="Liquidação" className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Começa em (horário de Brasília)</span>
          <input type="datetime-local" name="inicio" required className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Termina em (horário de Brasília)</span>
          <input type="datetime-local" name="fim" required className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Arredondar o preço promocional</span>
          <select name="arredondar" defaultValue="90" className={fieldClass}>
            <option value="nenhum">Sem arredondar</option>
            <option value="90">Terminar em ,90</option>
            <option value="00">Real inteiro</option>
          </select>
        </label>
      </div>
      <p className="text-sm text-muted">
        Cada produto marcado recebe o desconto da sua linha como preço promocional. Ao terminar, tudo volta ao que era antes. Nada vai à loja até a promoção começar (você pode usar “Iniciar agora” na tela
        seguinte).
      </p>
      {state?.message && (
        <p role="alert" className="text-sm text-danger">
          {state.message}
        </p>
      )}
      <div>
        <Button type="submit" disabled={pending || escolhidas.length === 0}>
          {pending ? "Agendando…" : `Agendar liquidação de ${escolhidas.length} ${escolhidas.length === 1 ? "produto" : "produtos"}`}
        </Button>
      </div>
    </form>
  );
}
