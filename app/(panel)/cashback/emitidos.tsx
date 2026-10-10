"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export interface Emitido {
  orderId: string;
  numero: number | null;
  codigo: string;
  valor: number;
  validade: string;
  emitidoEm: string;
  contatada: boolean;
  situacao: string;
  usado: boolean;
}

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const SITUACAO: Record<string, string> = { ativo: "Ativo", esgotado: "Usado", vencido: "Vencido", inativo: "Desativado", agendado: "Agendado", cancelado: "Cancelado", desconhecida: "Não achei na loja" };

export function Emitidos({ itens, lido }: { itens: Emitido[]; lido: boolean }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ id: string; mensagem: string; whatsapp: string | null; email: string | null } | null>(null);

  async function chamar(url: string, body: unknown) {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { ok: res.ok, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  }

  async function mensagem(orderId: string) {
    setOcupado(orderId);
    setErro(null);
    const r = await chamar("/api/cashback/mensagem", { orderId });
    setOcupado(null);
    if (!r.ok) return setErro(String(r.data.error ?? "Não foi possível montar a mensagem."));
    setMsg({ id: orderId, mensagem: String(r.data.mensagem), whatsapp: (r.data.whatsapp as string | null) ?? null, email: (r.data.email as string | null) ?? null });
  }

  async function acao(orderId: string, a: "contatada" | "pendente" | "cancelar") {
    if (a === "cancelar" && !confirm("Cancelar este cupom? Ele será desativado na loja e sai do orçamento do mês.")) return;
    setOcupado(orderId);
    setErro(null);
    const r = await chamar("/api/cashback/acao", { orderId, acao: a });
    setOcupado(null);
    if (!r.ok) return setErro(String(r.data.error ?? "Não foi possível concluir."));
    router.refresh();
  }

  const custo = itens.filter((i) => i.usado).reduce((s, i) => s + i.valor, 0);

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">Cupons emitidos</h2>
        {lido && itens.length > 0 && <p className="text-sm text-muted">Já usados pelas clientes: {brl(custo)}</p>}
      </div>
      {!lido && <p className="text-xs text-muted">Não consegui ler os cupons da loja agora; a situação abaixo pode estar desatualizada.</p>}
      {erro && <p role="alert" className="text-sm text-danger">{erro}</p>}
      {itens.length === 0 ? (
        <p className="text-sm text-muted">Nenhum cupom emitido ainda.</p>
      ) : (
        <ul className="divide-y divide-border">
          {itens.map((i) => (
            <li key={i.orderId} className="flex flex-col gap-2 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">
                  <span className="font-mono">{i.codigo}</span> <span className="font-normal text-muted">· pedido #{i.numero ?? i.orderId} · {brl(i.valor)} · até {dia(i.validade)}</span>
                </p>
                <p className="text-xs">
                  {SITUACAO[i.situacao] ?? i.situacao}
                  {i.contatada ? " · cliente avisada" : ""}
                </p>
              </div>
              {i.situacao !== "cancelado" && (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" disabled={ocupado === i.orderId} onClick={() => mensagem(i.orderId)}>
                    Mensagem para a cliente
                  </Button>
                  <Button type="button" variant="outline" disabled={ocupado === i.orderId} onClick={() => acao(i.orderId, i.contatada ? "pendente" : "contatada")}>
                    {i.contatada ? "Desmarcar aviso" : "Marcar como avisada"}
                  </Button>
                  {!i.usado && (
                    <button type="button" className="text-sm text-danger underline" disabled={ocupado === i.orderId} onClick={() => acao(i.orderId, "cancelar")}>
                      Cancelar cupom
                    </button>
                  )}
                </div>
              )}
              {msg?.id === i.orderId && (
                <div className="flex flex-col gap-2 rounded-md border border-border p-3">
                  <textarea readOnly value={msg.mensagem} rows={5} className="w-full rounded border border-border bg-background p-2 text-sm" />
                  <div className="flex flex-wrap gap-2">
                    {msg.whatsapp && (
                      <a href={msg.whatsapp} target="_blank" rel="noopener noreferrer" className="underline">
                        Abrir no WhatsApp
                      </a>
                    )}
                    {msg.email && (
                      <a href={msg.email} className="underline">
                        Abrir no e-mail
                      </a>
                    )}
                    {!msg.whatsapp && !msg.email && <span className="text-muted">A loja não trouxe telefone nem e-mail deste pedido: copie o texto.</span>}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
