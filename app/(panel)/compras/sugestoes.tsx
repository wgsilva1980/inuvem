"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fieldBase } from "@/components/ui/field";

export interface LinhaSugestao {
  variantId: string;
  productId: string;
  produto: string;
  variacao: string;
  estoque: number;
  vendidas: number;
  aCaminho: number;
  diasRestantes: number | null;
  sugerido: number;
  custo: number | null;
}

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const textoDias = (d: number | null) => (d === null ? "Esgotado" : d < 1 ? "menos de 1 dia" : `${Math.round(d)} ${Math.round(d) === 1 ? "dia" : "dias"}`);

export function Sugestoes({ linhas, janela }: { linhas: LinhaSugestao[]; janela: number }) {
  const router = useRouter();
  const [qtd, setQtd] = useState<Record<string, string>>(() => Object.fromEntries(linhas.map((l) => [l.variantId, String(l.sugerido)])));
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [fornecedor, setFornecedor] = useState("");
  const [previsto, setPrevisto] = useState("");
  const [obs, setObs] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const escolhidas = useMemo(() => linhas.filter((l) => marcadas.has(l.variantId)), [linhas, marcadas]);
  const n = (id: string) => Number.parseInt(qtd[id] ?? "", 10);
  const valida = (id: string) => Number.isInteger(n(id)) && n(id) >= 1 && n(id) <= 9999;
  const total = escolhidas.reduce((s, l) => s + (l.custo === null || !valida(l.variantId) ? 0 : l.custo * n(l.variantId)), 0);
  const semCusto = escolhidas.filter((l) => l.custo === null).length;
  const todasMarcadas = linhas.length > 0 && linhas.every((l) => marcadas.has(l.variantId));
  const pode = escolhidas.length > 0 && escolhidas.every((l) => valida(l.variantId)) && fornecedor.trim().length >= 2 && !enviando;

  function alternar(id: string) {
    setMarcadas((m) => {
      const novo = new Set(m);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  async function criar() {
    setEnviando(true);
    setErro(null);
    try {
      const res = await fetch("/api/compras/criar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ supplier: fornecedor, expectedOn: previsto || null, note: obs || null, itens: escolhidas.map((l) => ({ variantId: l.variantId, qty: n(l.variantId) })) }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Não foi possível criar o pedido.");
      router.push("/compras?aba=pedidos");
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao criar o pedido.");
      setEnviando(false);
    }
  }

  if (linhas.length === 0) {
    return (
      <Card>
        <p className="text-sm text-muted">Nada para comprar com estes parâmetros: o estoque (e o que já está a caminho) cobre o prazo e a cobertura escolhidos para tudo o que vendeu.</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs text-muted">
                <th className="py-1 pr-2">
                  <input type="checkbox" aria-label="Marcar todas" checked={todasMarcadas} onChange={() => setMarcadas(todasMarcadas ? new Set() : new Set(linhas.map((l) => l.variantId)))} />
                </th>
                <th className="py-1 pr-3 font-medium">Produto</th>
                <th className="py-1 pr-3 font-medium">Variação</th>
                <th className="py-1 pr-3 text-right font-medium">Estoque</th>
                <th className="py-1 pr-3 text-right font-medium">Vendeu ({janela} d)</th>
                <th className="py-1 pr-3 text-right font-medium">Acaba em</th>
                <th className="py-1 pr-3 text-right font-medium">A caminho</th>
                <th className="py-1 text-right font-medium">Comprar</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.variantId} className="border-t border-border align-top">
                  <td className="py-2 pr-2">
                    <input type="checkbox" aria-label={`Escolher ${l.produto} ${l.variacao}`} checked={marcadas.has(l.variantId)} onChange={() => alternar(l.variantId)} />
                  </td>
                  <td className="py-2 pr-3">
                    <Link href={`/produtos/${l.productId}`} className="font-medium hover:underline">
                      {l.produto}
                    </Link>
                    {l.custo === null && <span className="block text-xs text-muted">sem custo</span>}
                  </td>
                  <td className="py-2 pr-3">{l.variacao}</td>
                  <td className="py-2 pr-3 text-right">{l.estoque}</td>
                  <td className="py-2 pr-3 text-right">{l.vendidas}</td>
                  <td className={`py-2 pr-3 text-right ${l.diasRestantes === null ? "font-medium text-danger" : ""}`}>{textoDias(l.diasRestantes)}</td>
                  <td className="py-2 pr-3 text-right">{l.aCaminho > 0 ? l.aCaminho : "—"}</td>
                  <td className="py-2 text-right">
                    <input aria-label={`Quantidade ${l.produto} ${l.variacao}`} value={qtd[l.variantId] ?? ""} onChange={(e) => setQtd((q) => ({ ...q, [l.variantId]: e.target.value }))} inputMode="numeric" className={`${fieldBase} w-20 text-right`} aria-invalid={marcadas.has(l.variantId) && !valida(l.variantId)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="flex flex-col gap-3 text-sm">
        <h2 className="font-medium">Criar pedido de compra</h2>
        <p className="text-muted">
          {escolhidas.length === 0 ? "Marque os itens que vai comprar." : `${escolhidas.length} ${escolhidas.length === 1 ? "item" : "itens"}, ${escolhidas.reduce((s, l) => s + (valida(l.variantId) ? n(l.variantId) : 0), 0)} unidades`}
          {escolhidas.length > 0 && total > 0 && ` · investimento estimado de ${brl(total)}`}
          {semCusto > 0 && ` (${semCusto} sem custo informado)`}
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="text-muted">Fornecedor</span>
            <input value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} maxLength={80} className={fieldBase} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted">Previsão de chegada (opcional)</span>
            <input type="date" value={previsto} onChange={(e) => setPrevisto(e.target.value)} className={fieldBase} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted">Observação (opcional)</span>
            <input value={obs} onChange={(e) => setObs(e.target.value)} maxLength={500} className={fieldBase} />
          </label>
        </div>
        {erro && (
          <p role="alert" className="text-danger">
            {erro}
          </p>
        )}
        <div>
          <Button type="button" onClick={criar} disabled={!pode} className="min-h-11">
            {enviando ? "Criando…" : "Criar pedido de compra"}
          </Button>
        </div>
        <p className="text-xs text-muted">O pedido não altera a loja: ele só passa a contar como “a caminho”, para a sugestão não pedir de novo o que você já comprou.</p>
      </Card>
    </div>
  );
}
