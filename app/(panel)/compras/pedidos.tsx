"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export interface PedidoVista {
  id: string;
  fornecedor: string;
  previsto: string | null;
  atrasado: boolean;
  observacao: string | null;
  status: "aberto" | "recebido" | "cancelado";
  estoqueAtualizado: boolean;
  criadoEm: string;
  total: number;
  semCusto: number;
  itens: Array<{ seq: number; productId: string; produto: string; variacao: string; qty: number; recebido: boolean }>;
}

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const STATUS = { aberto: "Aberto", recebido: "Recebido", cancelado: "Cancelado" } as const;

export function Pedidos({ pedidos }: { pedidos: PedidoVista[] }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  async function chamar(url: string, body: unknown) {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { ok: res.ok, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  }

  async function receber(p: PedidoVista, somarEstoque: boolean) {
    const pergunta = somarEstoque
      ? `Somar as quantidades ao estoque da loja e fechar o pedido de ${p.fornecedor}? As quantidades serão enviadas à Nuvemshop agora.`
      : `Marcar o pedido de ${p.fornecedor} como recebido SEM mexer no estoque da loja? Use isto só se você já lançou o estoque por outro caminho.`;
    if (!confirm(pergunta)) return;
    setOcupado(p.id);
    setMsg(null);
    const r = await chamar("/api/compras/receber", { id: p.id, somarEstoque });
    setOcupado(null);
    if (!r.ok) return setMsg({ ok: false, texto: String(r.data.error ?? "Não foi possível receber o pedido.") });
    const erros = (r.data.erros as string[] | undefined) ?? [];
    if (r.data.status === "recebido") setMsg({ ok: true, texto: somarEstoque ? `Estoque somado (${r.data.somados} ${r.data.somados === 1 ? "linha" : "linhas"}) e pedido fechado.` : "Pedido marcado como recebido." });
    else setMsg({ ok: false, texto: `${r.data.somados} somada(s), ${r.data.pendentes} pendente(s).${r.data.continua ? " Acabou o tempo desta etapa: clique em receber de novo para continuar." : ""}${erros.length > 0 ? ` Não deu certo: ${erros.join(" · ")}` : ""}` });
    router.refresh();
  }

  async function cancelar(p: PedidoVista) {
    if (!confirm(`Cancelar o pedido de ${p.fornecedor}? Ele deixa de contar como “a caminho”.`)) return;
    setOcupado(p.id);
    setMsg(null);
    const r = await chamar("/api/compras/cancelar", { id: p.id });
    setOcupado(null);
    if (!r.ok) return setMsg({ ok: false, texto: String(r.data.error ?? "Não foi possível cancelar.") });
    router.refresh();
  }

  if (pedidos.length === 0) {
    return (
      <Card>
        <p className="text-sm text-muted">Nenhum pedido de compra ainda. Crie o primeiro na aba Sugestão.</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={`rounded-md border border-border bg-card p-3 text-sm ${msg.ok ? "text-success" : "text-danger"}`}>
          {msg.texto}
        </p>
      )}
      {pedidos.map((p) => {
        const unidades = p.itens.reduce((s, i) => s + i.qty, 0);
        return (
          <Card key={p.id} className="flex flex-col gap-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{p.fornecedor}</span>
                <Badge tone={p.status === "aberto" ? (p.atrasado ? "danger" : "warning") : p.status === "recebido" ? "success" : "neutral"}>{p.atrasado && p.status === "aberto" ? "Atrasado" : STATUS[p.status]}</Badge>
                {p.status === "recebido" && !p.estoqueAtualizado && <Badge>Estoque não somado pelo painel</Badge>}
              </div>
              <span className="text-xs text-muted">criado em {dia(p.criadoEm)}</span>
            </div>
            <p className="text-muted">
              {p.itens.length} {p.itens.length === 1 ? "item" : "itens"}, {unidades} unidades
              {p.total > 0 && ` · ${brl(p.total)}${p.semCusto > 0 ? ` (+${p.semCusto} sem custo)` : ""}`}
              {p.previsto && ` · previsto para ${dia(p.previsto)}`}
            </p>
            {p.observacao && <p className="text-muted">Obs.: {p.observacao}</p>}
            <details>
              <summary className="cursor-pointer text-muted">Ver itens</summary>
              <ul className="mt-2 flex flex-col gap-1">
                {p.itens.map((i) => (
                  <li key={i.seq}>
                    <Link href={`/produtos/${i.productId}`} className="hover:underline">
                      {i.produto}
                    </Link>{" "}
                    <span className="text-muted">
                      {i.variacao} · {i.qty} un.{i.recebido ? " · somada ao estoque" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
            {p.status === "aberto" && (
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={() => receber(p, true)} disabled={ocupado === p.id} className="min-h-11">
                  {ocupado === p.id ? "Trabalhando…" : "Recebido: somar ao estoque da loja"}
                </Button>
                <Button type="button" variant="outline" onClick={() => receber(p, false)} disabled={ocupado === p.id} className="min-h-11">
                  Recebido (sem mexer no estoque)
                </Button>
                <Button type="button" variant="outline" onClick={() => cancelar(p)} disabled={ocupado === p.id} className="min-h-11">
                  Cancelar pedido
                </Button>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
