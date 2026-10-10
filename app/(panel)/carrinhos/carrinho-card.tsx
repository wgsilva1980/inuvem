"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { fieldClass } from "@/components/ui/field";
import { idadeTexto } from "@/lib/carts/logic";

interface Props {
  carrinho: { id: number; nome: string | null; tem_whatsapp: boolean; email: string | null; total: number; criadoEm: string; itens: Array<{ nome: string; quantidade: number }> };
  contato: { contatadoEm: string | null; por: string | null; cupom: string | null } | null;
}

interface Pronta {
  error?: string;
  mensagem: string;
  whatsapp: string | null;
  email: string | null;
  cupom: { codigo: string; percent: number; validade: string } | null;
  geradaPorIa: boolean;
}

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Um carrinho: peças, escrever a mensagem (com cupom opcional), abrir o WhatsApp e marcar como contatado. */
export function CarrinhoCard({ carrinho: c, contato }: Props) {
  const router = useRouter();
  const [comCupom, setComCupom] = useState(false);
  const [percent, setPercent] = useState("10");
  const [dias, setDias] = useState("3");
  const [ocupado, setOcupado] = useState(false);
  const [pronta, setPronta] = useState<Pronta | null>(null);
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  async function escrever() {
    const p = Number(percent.replace(",", "."));
    const d = Number(dias);
    if (comCupom) {
      if (!Number.isFinite(p) || p < 1 || p > 50 || !Number.isInteger(d) || d < 1 || d > 30) {
        setErro("O cupom precisa ter de 1% a 50% e de 1 a 30 dias.");
        return;
      }
      if (!contato?.cupom && !window.confirm(`Criar na loja um cupom de ${p}% (1 uso, ${d} dia(s)) para este carrinho?`)) return;
    }
    setOcupado(true);
    setErro(null);
    try {
      const res = await fetch("/api/carrinhos/mensagem", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: c.id, cupom: comCupom ? { percent: p, dias: d } : null }) });
      const d2 = (await res.json()) as Pronta;
      if (!res.ok || d2.error) throw new Error(d2.error ?? "Falha ao escrever a mensagem.");
      setPronta(d2);
      setTexto(d2.mensagem);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao escrever a mensagem.");
    } finally {
      setOcupado(false);
    }
  }

  async function marcar(contatado: boolean) {
    setOcupado(true);
    setErro(null);
    try {
      const res = await fetch("/api/carrinhos/contatado", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: c.id, contatado }) });
      if (!res.ok) throw new Error("Falha ao salvar.");
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setOcupado(false);
    }
  }

  // o link do WhatsApp/e-mail leva o texto como está na caixa (a pessoa pode editar antes)
  const linkWhats = pronta?.whatsapp ? pronta.whatsapp.replace(/\?text=.*$/, `?text=${encodeURIComponent(texto)}`) : null;
  const linkMail = pronta?.email ? pronta.email.replace(/&body=.*$/, `&body=${encodeURIComponent(texto)}`) : null;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{c.nome ?? c.email ?? `Carrinho ${c.id}`}</span>
        <span className="text-sm text-muted">
          {brl(c.total)} · parado há {idadeTexto(c.criadoEm)}
        </span>
        {contato?.contatadoEm && <Badge tone="success">Contatado</Badge>}
        {contato?.cupom && <Badge>Cupom {contato.cupom}</Badge>}
        {!c.tem_whatsapp && <Badge tone="warning">Sem WhatsApp</Badge>}
      </div>
      <p className="text-sm text-muted">
        {c.itens.slice(0, 4).map((i) => `${i.quantidade > 1 ? `${i.quantidade}× ` : ""}${i.nome}`).join(" · ")}
        {c.itens.length > 4 ? ` · +${c.itens.length - 4}` : ""}
      </p>

      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" className="h-4 w-4" checked={comCupom} onChange={(e) => setComCupom(e.target.checked)} />
          Com cupom de cortesia
        </label>
        {comCupom && !contato?.cupom && (
          <>
            <label className="flex items-center gap-1">
              <input value={percent} onChange={(e) => setPercent(e.target.value)} inputMode="decimal" aria-label="Desconto em %" className={`${fieldClass} w-16`} />%
            </label>
            <label className="flex items-center gap-1">
              válido por <input value={dias} onChange={(e) => setDias(e.target.value)} inputMode="numeric" aria-label="Validade em dias" className={`${fieldClass} w-14`} /> dia(s)
            </label>
          </>
        )}
        {comCupom && contato?.cupom && <span className="text-muted">Já existe o cupom {contato.cupom} para este carrinho; ele será reaproveitado.</span>}
        <Button type="button" variant="outline" disabled={ocupado} onClick={escrever}>
          {ocupado && !pronta ? "Escrevendo…" : pronta ? "Escrever de novo" : "Escrever a mensagem"}
        </Button>
      </div>

      {pronta && (
        <div className="flex flex-col gap-2" role="status" aria-live="polite">
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={7} aria-label="Mensagem" className="rounded-md border border-border-strong bg-background px-3 py-2 text-sm" />
          {!pronta.geradaPorIa && <p className="text-xs text-muted">Texto padrão (a chave da API da Anthropic não está configurada).</p>}
          {pronta.cupom && (
            <p className="text-xs text-muted">
              Cupom {pronta.cupom.codigo}: {pronta.cupom.percent}%, {pronta.cupom.validade}, 1 uso.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {linkWhats && (
              <a href={linkWhats} target="_blank" rel="noopener noreferrer" className={buttonClass("primary")}>
                Abrir no WhatsApp
              </a>
            )}
            {linkMail && (
              <a href={linkMail} className={buttonClass("outline")}>
                Abrir no e-mail
              </a>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(texto).catch(() => {});
                setCopiado(true);
                setTimeout(() => setCopiado(false), 2000);
              }}
            >
              {copiado ? "Copiado" : "Copiar texto"}
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {contato?.contatadoEm ? (
          <Button type="button" variant="outline" disabled={ocupado} onClick={() => marcar(false)}>
            Desmarcar contato
          </Button>
        ) : (
          <Button type="button" variant="outline" disabled={ocupado} onClick={() => marcar(true)}>
            Marcar como contatado
          </Button>
        )}
        {contato?.contatadoEm && (
          <span className="text-xs text-muted">
            por {contato.por} em {new Date(contato.contatadoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}
          </span>
        )}
      </div>
      {erro && (
        <p role="alert" className="text-sm text-danger">
          {erro}
        </p>
      )}
    </div>
  );
}
