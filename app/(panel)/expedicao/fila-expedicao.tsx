"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { fieldClass } from "@/components/ui/field";
import { lerRastreios } from "@/lib/shipping/queue";

export interface PedidoFila {
  id: string;
  numero: number | null;
  criadoEm: string;
  diasParado: number;
  atrasado: boolean;
  total: number;
  rastreio: string | null;
  unidades: number;
  itens: Array<{ nome: string; variacao: string; quantidade: number; foto: string | null }>;
}

const CODIGO = /^[A-Z0-9][A-Z0-9._-]{4,39}$/;
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const limpar = (s: string) => s.trim().toUpperCase().replace(/\s+/g, "");

/** Fila de expedição: marcar pedidos, imprimir a lista de separação, preencher o rastreio (um a um ou colando uma lista) e marcar como enviados. */
export function FilaExpedicao({ pedidos }: { pedidos: PedidoFila[] }) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [codigos, setCodigos] = useState<Record<string, string>>({});
  const [colado, setColado] = useState("");
  const [avisosColar, setAvisosColar] = useState<string[]>([]);
  const [notificar, setNotificar] = useState(false);
  const [rodando, setRodando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const alternar = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const prontos = pedidos.filter((p) => sel.has(p.id) && CODIGO.test(limpar(codigos[p.id] ?? "")));

  function aplicarColado() {
    const { validos, problemas } = lerRastreios(colado);
    const porNumero = new Map(pedidos.filter((p) => p.numero !== null).map((p) => [p.numero!, p]));
    const novos = { ...codigos };
    const marcar = new Set(sel);
    const avisos = problemas.map((p) => `“${p.linha}”: ${p.motivo}`);
    let usados = 0;
    for (const v of validos) {
      const p = porNumero.get(v.numero);
      if (!p) {
        avisos.push(`Pedido ${v.numero}: não está na fila (já enviado, cancelado ou fora do filtro atual).`);
        continue;
      }
      novos[p.id] = v.codigo;
      marcar.add(p.id);
      usados++;
    }
    setCodigos(novos);
    setSel(marcar);
    setAvisosColar(avisos);
    setMsg(`${usados} código(s) preenchido(s) e pedidos marcados. Confira e clique em “Marcar como enviados”.`);
  }

  async function enviar() {
    if (!window.confirm(`Marcar ${prontos.length} pedido(s) como enviados na loja${notificar ? ", avisando as clientes por e-mail (a loja envia)" : " (sem avisar as clientes pela loja)"}? Cada pedido é conferido na loja antes.`)) return;
    setRodando(true);
    setErro(null);
    setMsg(null);
    let ok = 0;
    const falhas: string[] = [];
    try {
      for (let i = 0; i < prontos.length; i += 10) {
        const parte = prontos.slice(i, i + 10);
        const res = await fetch("/api/expedicao/enviar", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ envios: parte.map((p) => ({ orderId: Number(p.id), codigo: limpar(codigos[p.id]!) })), notificar }),
        });
        const d = (await res.json()) as { error?: string; resultados?: Array<{ orderId: number; numero: number | null; ok: boolean; pulado?: boolean; erro?: string }> };
        if (!res.ok || d.error) throw new Error(d.error ?? "Falha ao marcar como enviado.");
        for (const r of d.resultados ?? []) {
          if (r.ok) ok++;
          else falhas.push(`#${r.numero ?? r.orderId}: ${r.erro}`);
        }
        if ((d.resultados ?? []).length < parte.length) break; // parou (ex.: sem permissão)
      }
      setMsg(`${ok} pedido(s) marcado(s) como enviado(s).${falhas.length ? ` Com problema: ${falhas.slice(0, 5).join(" · ")}` : ""}`);
      setSel(new Set());
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao marcar como enviado.");
    } finally {
      setRodando(false);
      router.refresh();
    }
  }

  const linkSeparacao = sel.size > 0 ? `/expedicao/separacao?ids=${[...sel].join(",")}` : "/expedicao/separacao";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={linkSeparacao} className={buttonClass("outline")} target="_blank">
          Lista de separação {sel.size > 0 ? `(${sel.size} marcados)` : "(todos)"}
        </Link>
        <Button type="button" variant="outline" onClick={() => setSel(new Set(pedidos.map((p) => p.id)))}>
          Marcar todos
        </Button>
        <Button type="button" variant="outline" disabled={sel.size === 0} onClick={() => setSel(new Set())}>
          Desmarcar
        </Button>
      </div>

      <details className="rounded-md border border-border bg-card p-3 text-sm">
        <summary className="cursor-pointer font-medium">Colar uma lista de rastreios (número do pedido e código)</summary>
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-muted">Uma linha por pedido, por exemplo <code>1234;AA123456789BR</code> (ou separado por espaço, vírgula ou tabulação, como ao copiar de uma planilha).</p>
          <textarea value={colado} onChange={(e) => setColado(e.target.value)} rows={5} aria-label="Lista de rastreios" className="rounded-md border border-border-strong bg-background px-3 py-2 font-mono text-xs" />
          <div>
            <Button type="button" variant="outline" disabled={colado.trim() === ""} onClick={aplicarColado}>
              Preencher os códigos
            </Button>
          </div>
          {avisosColar.length > 0 && (
            <ul className="list-disc pl-5 text-xs text-danger">
              {avisosColar.slice(0, 8).map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          )}
        </div>
      </details>

      {pedidos.length === 0 ? (
        <p className="rounded-md border border-border bg-card p-4 text-sm text-muted">Nenhum pedido a enviar com este filtro.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {pedidos.map((p) => {
            const cod = limpar(codigos[p.id] ?? "");
            return (
              <li key={p.id} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-center">
                <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                  <input type="checkbox" className="mt-1 size-5" checked={sel.has(p.id)} onChange={() => alternar(p.id)} aria-label={`Marcar o pedido ${p.numero ?? p.id}`} />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">Pedido #{p.numero ?? p.id}</span>
                      <span className="text-sm text-muted">
                        {brl(p.total)} · há {p.diasParado} {p.diasParado === 1 ? "dia" : "dias"} · {p.unidades} {p.unidades === 1 ? "peça" : "peças"}
                      </span>
                      {p.atrasado && <Badge tone="danger">Atrasado</Badge>}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-2">
                      {p.itens.slice(0, 4).map((i, n) => (
                        <span key={n} className="flex items-center gap-1 text-xs text-muted">
                          {i.foto && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={i.foto} alt="" width={28} height={28} loading="lazy" className="h-7 w-7 rounded border border-border object-cover" />
                          )}
                          {i.quantidade}× {i.nome}
                          {i.variacao ? ` (${i.variacao})` : ""}
                        </span>
                      ))}
                      {p.itens.length > 4 && <span className="text-xs text-muted">+{p.itens.length - 4}</span>}
                    </span>
                  </span>
                </label>
                <label className="flex shrink-0 flex-col gap-1 text-xs text-muted">
                  Código de rastreio
                  <input
                    value={codigos[p.id] ?? ""}
                    onChange={(e) => setCodigos((c) => ({ ...c, [p.id]: e.target.value }))}
                    placeholder={p.rastreio ?? "AA123456789BR"}
                    aria-invalid={cod !== "" && !CODIGO.test(cod)}
                    className={`${fieldClass} w-48 font-mono ${cod !== "" && !CODIGO.test(cod) ? "border-danger" : ""}`}
                  />
                </label>
              </li>
            );
          })}
        </ul>
      )}

      <div className="sticky bottom-3 z-10 flex flex-col gap-2 rounded-lg border border-border-strong bg-card p-3 shadow-lg" role="status" aria-live="polite">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1 h-4 w-4" checked={notificar} onChange={(e) => setNotificar(e.target.checked)} />
          <span>
            Pedir à loja que avise a cliente por e-mail com o rastreio
            <span className="block text-xs text-muted">Desmarcado, o pedido muda para enviado sem e-mail da loja (você pode avisar pelo WhatsApp).</span>
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" disabled={rodando || prontos.length === 0} onClick={enviar}>
            {rodando ? "Marcando… (mantenha a página aberta)" : `Marcar como enviados (${prontos.length})`}
          </Button>
          <span className="text-xs text-muted">Só vão os pedidos marcados que têm um código de rastreio válido.</span>
        </div>
        {msg && <p className="text-sm">{msg}</p>}
        {erro && (
          <p role="alert" className="text-sm text-danger">
            {erro}
          </p>
        )}
      </div>
    </div>
  );
}
