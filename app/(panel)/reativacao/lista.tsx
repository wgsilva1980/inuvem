"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export interface Linha {
  id: string;
  nome: string;
  local: string | null;
  ultimaCompra: string;
  diasSemComprar: number;
  pedidos: number;
  totalGasto: number;
  temWhatsapp: boolean;
  temEmail: boolean;
}

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

export function Lista({ linhas }: { linhas: Linha[] }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberta, setAberta] = useState<{ id: string; mensagem: string; whatsapp: string | null; email: string | null } | null>(null);
  const [copiado, setCopiado] = useState(false);

  async function chamar(url: string, customerId: string) {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ customerId }) });
    return { ok: res.ok, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  }

  async function mensagem(id: string) {
    setOcupado(id);
    setErro(null);
    setCopiado(false);
    const r = await chamar("/api/reativacao/mensagem", id);
    setOcupado(null);
    if (!r.ok) return setErro(String(r.data.error ?? "Não foi possível montar a mensagem."));
    setAberta({ id, mensagem: String(r.data.mensagem), whatsapp: (r.data.whatsapp as string | null) ?? null, email: (r.data.email as string | null) ?? null });
  }

  async function avisada(id: string) {
    setOcupado(id);
    setErro(null);
    const r = await chamar("/api/reativacao/avisar", id);
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
        <p className="text-sm text-muted">Nenhuma cliente nessa faixa. Tente um prazo menor ou sincronize os pedidos e os clientes.</p>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-3">
      {erro && <p role="alert" className="text-sm text-danger">{erro}</p>}
      <ul className="divide-y divide-border">
        {linhas.map((l) => (
          <li key={l.id} className="flex flex-col gap-2 py-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-col">
                <span className="font-medium">{l.nome}</span>
                <span className="text-xs text-muted">
                  {l.local ? `${l.local} · ` : ""}
                  {l.pedidos} {l.pedidos === 1 ? "pedido" : "pedidos"} · {brl(l.totalGasto)} no total · última compra em {dia(l.ultimaCompra)} (há {l.diasSemComprar} dias)
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" disabled={ocupado === l.id || (!l.temWhatsapp && !l.temEmail)} onClick={() => mensagem(l.id)} className="min-h-11">
                  Mensagem
                </Button>
                <Button type="button" variant="outline" disabled={ocupado === l.id} onClick={() => avisada(l.id)} className="min-h-11">
                  Marcar como avisada
                </Button>
              </div>
            </div>
            {!l.temWhatsapp && !l.temEmail && <p className="text-xs text-muted">Sem telefone nem e-mail no cadastro (sincronize os clientes em Contatos).</p>}
            {aberta?.id === l.id && (
              <div className="flex flex-col gap-2 rounded-md border border-border p-3">
                <textarea readOnly value={aberta.mensagem} rows={5} className="w-full rounded-md border border-border bg-white p-2 text-sm" aria-label={`Mensagem para ${l.nome}`} />
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
                <p className="text-xs text-muted">O painel não envia nada. Depois de mandar a mensagem, clique em “Marcar como avisada” para ela sair da lista por 30 dias.</p>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
