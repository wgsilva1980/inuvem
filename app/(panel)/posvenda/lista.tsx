"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { TipoMensagem } from "@/lib/postsale/rules";

export interface Linha {
  orderId: string;
  numero: number | null;
  nome: string;
  local: string | null;
  total: number;
  enviadoEm: string;
  diasDesdeEnvio: number;
  temWhatsapp: boolean;
  temEmail: boolean;
}

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

export function Lista({ linhas, tipos }: { linhas: Linha[]; tipos: Array<{ id: TipoMensagem; rotulo: string }> }) {
  const router = useRouter();
  const [tipo, setTipo] = useState<TipoMensagem>(tipos[0]!.id);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberta, setAberta] = useState<{ id: string; mensagem: string; whatsapp: string | null; email: string | null } | null>(null);
  const [copiado, setCopiado] = useState(false);

  async function chamar(url: string, corpo: Record<string, string>) {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
    return { ok: res.ok, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  }

  async function mensagem(orderId: string) {
    setOcupado(orderId);
    setErro(null);
    setCopiado(false);
    const r = await chamar("/api/posvenda/mensagem", { orderId, tipo });
    setOcupado(null);
    if (!r.ok) return setErro(String(r.data.error ?? "Não foi possível montar a mensagem."));
    setAberta({ id: orderId, mensagem: String(r.data.mensagem), whatsapp: (r.data.whatsapp as string | null) ?? null, email: (r.data.email as string | null) ?? null });
  }

  async function avisada(orderId: string) {
    setOcupado(orderId);
    setErro(null);
    const r = await chamar("/api/posvenda/avisar", { orderId });
    setOcupado(null);
    if (!r.ok) return setErro(String(r.data.error ?? "Não foi possível marcar."));
    setAberta(null);
    router.refresh();
  }

  async function copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
    } catch {
      setErro("Não consegui copiar; selecione o texto e copie à mão.");
    }
  }

  if (linhas.length === 0) {
    return (
      <Card>
        <p className="text-sm text-muted">Nenhum pedido nessa faixa. Tente um prazo menor, ou leia os pedidos e sincronize os clientes.</p>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-3">
      <fieldset className="flex flex-wrap gap-4 text-sm">
        <legend className="mb-1 font-medium">Que mensagem?</legend>
        {tipos.map((t) => (
          <label key={t.id} className="flex min-h-11 items-center gap-2">
            <input type="radio" name="tipo" checked={tipo === t.id} onChange={() => (setTipo(t.id), setAberta(null))} className="size-4" />
            {t.rotulo}
          </label>
        ))}
      </fieldset>
      {erro && <p role="alert" className="text-sm text-danger">{erro}</p>}
      <ul className="divide-y divide-border">
        {linhas.map((l) => (
          <li key={l.orderId} className="flex flex-col gap-2 py-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-col">
                <span className="font-medium">{l.nome}</span>
                <span className="text-xs text-muted">
                  {l.local ? `${l.local} · ` : ""}pedido {l.numero !== null ? `#${l.numero}` : l.orderId} · {brl(l.total)} · enviado em {dia(l.enviadoEm)} (há {l.diasDesdeEnvio} dias)
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" disabled={ocupado === l.orderId || (!l.temWhatsapp && !l.temEmail)} onClick={() => mensagem(l.orderId)} className="min-h-11">
                  Mensagem
                </Button>
                <Button type="button" variant="outline" disabled={ocupado === l.orderId} onClick={() => avisada(l.orderId)} className="min-h-11">
                  Marcar como feito
                </Button>
              </div>
            </div>
            {!l.temWhatsapp && !l.temEmail && <p className="text-xs text-muted">Sem telefone nem e-mail no cadastro (sincronize os clientes em Contatos).</p>}
            {aberta?.id === l.orderId && (
              <div className="flex flex-col gap-2 rounded-md border border-border p-3">
                <textarea readOnly value={aberta.mensagem} rows={6} className="w-full rounded-md border border-border bg-white p-2 text-sm" aria-label={`Mensagem para ${l.nome}`} />
                <div className="flex flex-wrap gap-2">
                  {aberta.whatsapp && (
                    <a href={aberta.whatsapp} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm">
                      Abrir no WhatsApp
                    </a>
                  )}
                  {aberta.email && (
                    <a href={aberta.email} className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm">
                      Abrir no e-mail
                    </a>
                  )}
                  <Button type="button" variant="outline" onClick={() => copiar(aberta.mensagem)} className="min-h-11">
                    {copiado ? "Copiado" : "Copiar texto"}
                  </Button>
                </div>
                <p className="text-xs text-muted">O painel não envia nada. Depois de mandar a mensagem, clique em “Marcar como feito” para a cliente sair da lista por 30 dias.</p>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
