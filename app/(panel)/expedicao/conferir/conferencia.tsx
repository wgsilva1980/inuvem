"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fieldClass } from "@/components/ui/field";
import { ajustar, contagensVazias, lerCodigo, progresso, type ItemConferencia } from "@/lib/shipping/conferencia";
import { LeitorCamera, cameraSuportada } from "./leitor-camera";

export interface PedidoConferencia {
  id: string;
  numero: number | null;
  diasParado: number;
  atrasado: boolean;
  rastreio: string | null;
  itens: Array<ItemConferencia & { foto: string | null }>;
}

const CODIGO = /^[A-Z0-9][A-Z0-9._-]{4,39}$/;
const limpar = (s: string) => s.trim().toUpperCase().replace(/\s+/g, "");

type Aviso = { tom: "ok" | "erro" | "aviso"; texto: string };

function sinal(tom: Aviso["tom"]) {
  try {
    navigator.vibrate?.(tom === "ok" ? 40 : [120, 60, 120]);
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    osc.frequency.value = tom === "ok" ? 880 : 220;
    osc.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (tom === "ok" ? 0.08 : 0.25));
    osc.onended = () => void ctx.close();
  } catch {
    /* som e vibração são só um reforço */
  }
}

/** Conferência no celular: escolhe o pedido, lê cada peça (câmera, leitor de código de barras ou digitando o SKU) e só então marca como enviado. */
export function Conferencia({ pedidos }: { pedidos: PedidoConferencia[] }) {
  const router = useRouter();
  const [busca, setBusca] = useState("");
  const [abertoId, setAbertoId] = useState<string | null>(null);
  const [enviados, setEnviados] = useState<Set<string>>(new Set());
  const aberto = pedidos.find((p) => p.id === abertoId && !enviados.has(p.id)) ?? null;
  const restantes = pedidos.filter((p) => !enviados.has(p.id));
  const filtrados = useMemo(() => {
    const q = busca.replace(/\D/g, "");
    return q ? restantes.filter((p) => String(p.numero ?? "").includes(q)) : restantes;
  }, [busca, restantes]);

  if (!aberto) {
    return (
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Buscar pelo número do pedido
          <input value={busca} onChange={(e) => setBusca(e.target.value)} inputMode="numeric" placeholder="Ex.: 1234" className={`${fieldClass} text-base`} />
        </label>
        {filtrados.length === 0 ? (
          <p className="rounded-md border border-border bg-card p-4 text-sm text-muted">{restantes.length === 0 ? "Nenhum pedido a enviar. Atualize os pedidos na Expedição se esperava algum." : "Nenhum pedido com esse número na fila."}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {filtrados.map((p) => {
              const pecas = p.itens.reduce((s, i) => s + i.quantidade, 0);
              return (
                <li key={p.id}>
                  <button type="button" onClick={() => setAbertoId(p.id)} className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 text-left hover:bg-border/40">
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2 font-medium">
                        Pedido #{p.numero ?? p.id}
                        {p.atrasado && <Badge tone="danger">Atrasado</Badge>}
                      </span>
                      <span className="text-sm text-muted">
                        há {p.diasParado} {p.diasParado === 1 ? "dia" : "dias"} · {pecas} {pecas === 1 ? "peça" : "peças"}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm text-primary">Conferir →</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  return (
    <ConferirPedido
      key={aberto.id}
      pedido={aberto}
      aoVoltar={() => setAbertoId(null)}
      aoEnviar={() => {
        setEnviados((s) => new Set(s).add(aberto.id));
        setAbertoId(null);
        setBusca("");
        router.refresh();
      }}
    />
  );
}

function ConferirPedido({ pedido, aoVoltar, aoEnviar }: { pedido: PedidoConferencia; aoVoltar: () => void; aoEnviar: () => void }) {
  const itens = pedido.itens;
  const [contagens, setContagens] = useState<number[]>(() => contagensVazias(itens));
  const [codigo, setCodigo] = useState("");
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [camera, setCamera] = useState(false);
  const [lerRastreio, setLerRastreio] = useState(false);
  const [rastreio, setRastreio] = useState("");
  const [notificar, setNotificar] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const campo = useRef<HTMLInputElement>(null);
  const contagensRef = useRef(contagens);
  contagensRef.current = contagens;
  const [temCamera, setTemCamera] = useState(false);
  useEffect(() => setTemCamera(cameraSuportada()), []);

  const prog = progresso(itens, contagens);
  const cod = limpar(rastreio);
  const rastreioOk = CODIGO.test(cod);

  function registrar(bruto: string) {
    const atuais = contagensRef.current;
    const r = lerCodigo(itens, atuais, bruto);
    if (r.tipo === "vazio") return;
    if (r.tipo === "ok") {
      const novo = ajustar(itens, atuais, r.indice, 1);
      contagensRef.current = novo;
      setContagens(novo);
      const it = itens[r.indice]!;
      setAviso({ tom: "ok", texto: `${it.nome}${it.variacao ? ` (${it.variacao})` : ""}: ${novo[r.indice]}/${it.quantidade}` });
      sinal("ok");
    } else if (r.tipo === "excesso") {
      const it = itens[r.indice]!;
      setAviso({ tom: "aviso", texto: `Peça a mais: ${it.nome}${it.variacao ? ` (${it.variacao})` : ""} já foi lida ${it.quantidade}×. Tire do pacote.` });
      sinal("erro");
    } else {
      setAviso({ tom: "erro", texto: `“${bruto.trim()}” não é de nenhuma peça deste pedido. Confira se pegou o produto certo.` });
      sinal("erro");
    }
  }

  function enviarCampo(e: React.FormEvent) {
    e.preventDefault();
    registrar(codigo);
    setCodigo("");
    campo.current?.focus();
  }

  async function enviar() {
    if (!window.confirm(`Marcar o pedido #${pedido.numero ?? pedido.id} como enviado na loja${notificar ? ", avisando a cliente por e-mail (a loja envia)" : " (sem avisar a cliente pela loja)"}?`)) return;
    setEnviando(true);
    setErro(null);
    try {
      const res = await fetch("/api/expedicao/enviar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ envios: [{ orderId: Number(pedido.id), codigo: cod }], notificar }),
      });
      const d = (await res.json()) as { error?: string; resultados?: Array<{ ok: boolean; erro?: string }> };
      if (!res.ok || d.error) throw new Error(d.error ?? "Falha ao marcar como enviado.");
      const r = d.resultados?.[0];
      if (!r?.ok) throw new Error(r?.erro ?? "A loja não aceitou o envio.");
      aoEnviar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao marcar como enviado.");
    } finally {
      setEnviando(false);
    }
  }

  const corAviso = aviso?.tom === "ok" ? "border-green-600 text-green-700 dark:text-green-400" : aviso?.tom === "aviso" ? "border-amber-500 text-amber-700 dark:text-amber-400" : "border-danger text-danger";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="outline" onClick={aoVoltar}>
          ← Pedidos
        </Button>
        <p className="text-lg font-semibold">Pedido #{pedido.numero ?? pedido.id}</p>
      </div>

      <div className="rounded-lg border border-border bg-card p-3">
        <p className="flex items-baseline justify-between text-sm">
          <span className="text-muted">Peças conferidas</span>
          <span className="text-2xl font-semibold">
            {prog.lidas}/{prog.total}
          </span>
        </p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-border" role="progressbar" aria-valuemin={0} aria-valuemax={prog.total} aria-valuenow={prog.lidas} aria-label="Peças conferidas">
          <div className="h-full bg-primary transition-all" style={{ width: `${prog.total ? (prog.lidas / prog.total) * 100 : 0}%` }} />
        </div>
      </div>

      <form onSubmit={enviarCampo} className="flex gap-2">
        <input
          ref={campo}
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          autoFocus
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
          placeholder="Ler código de barras ou digitar o SKU"
          aria-label="Código de barras ou SKU da peça"
          className={`${fieldClass} min-w-0 flex-1 text-base`}
        />
        <Button type="submit" disabled={codigo.trim() === ""}>
          Somar
        </Button>
      </form>
      {temCamera && (
        <div>
          <Button type="button" variant="outline" className="w-full" onClick={() => { setCamera((c) => !c); setLerRastreio(false); }}>
            {camera ? "Fechar câmera" : "Ler com a câmera"}
          </Button>
        </div>
      )}
      {camera && <LeitorCamera aoLer={registrar} aoFechar={() => setCamera(false)} />}

      <div role="status" aria-live="polite" className="min-h-6">
        {aviso && <p className={`rounded-md border-2 p-2 text-sm font-medium ${corAviso}`}>{aviso.texto}</p>}
      </div>

      <ul className="flex flex-col gap-2">
        {itens.map((it, i) => {
          const feito = (contagens[i] ?? 0) >= it.quantidade;
          return (
            <li key={i} className={`flex items-center gap-3 rounded-lg border p-2 ${feito ? "border-green-600 bg-green-600/10" : "border-border bg-card"}`}>
              {it.foto ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.foto} alt="" width={64} height={64} className="h-16 w-16 shrink-0 rounded border border-border object-cover" />
              ) : (
                <span className="h-16 w-16 shrink-0 rounded border border-border" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium">{it.nome}</p>
                <p className="text-sm text-muted">{[it.variacao, it.sku ? `SKU ${it.sku}` : "sem SKU"].filter(Boolean).join(" · ")}</p>
                {!it.sku && !it.barras && <p className="text-xs text-danger">Sem SKU nem código de barras: some com o botão +.</p>}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" onClick={() => setContagens((c) => ajustar(itens, c, i, -1))} aria-label={`Tirar uma unidade de ${it.nome}`} className="size-9 rounded-md border border-border-strong text-lg hover:bg-border/40">
                  −
                </button>
                <span className="w-12 text-center text-lg font-semibold" aria-label={`${contagens[i] ?? 0} de ${it.quantidade}`}>
                  {contagens[i] ?? 0}/{it.quantidade}
                </span>
                <button type="button" onClick={() => setContagens((c) => ajustar(itens, c, i, 1))} aria-label={`Somar uma unidade de ${it.nome}`} className="size-9 rounded-md border border-border-strong text-lg hover:bg-border/40">
                  +
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="sticky bottom-3 z-10 flex flex-col gap-2 rounded-lg border border-border-strong bg-card p-3 shadow-lg">
        {!prog.completo ? (
          <p className="text-sm text-muted">
            Faltam {prog.total - prog.lidas} {prog.total - prog.lidas === 1 ? "peça" : "peças"}: {prog.faltando.slice(0, 3).map((f) => `${f.faltam}× ${itens[f.indice]!.nome}`).join(", ")}
            {prog.faltando.length > 3 ? "…" : ""}
          </p>
        ) : (
          <>
            <p className="text-sm font-medium text-green-700 dark:text-green-400">Pedido conferido. Agora o código de rastreio:</p>
            <div className="flex gap-2">
              <input
                value={rastreio}
                onChange={(e) => setRastreio(e.target.value)}
                placeholder={pedido.rastreio ?? "AA123456789BR"}
                autoCapitalize="characters"
                autoComplete="off"
                aria-label="Código de rastreio"
                aria-invalid={cod !== "" && !rastreioOk}
                className={`${fieldClass} min-w-0 flex-1 font-mono text-base ${cod !== "" && !rastreioOk ? "border-danger" : ""}`}
              />
              {temCamera && (
                <Button type="button" variant="outline" onClick={() => { setLerRastreio((v) => !v); setCamera(false); }}>
                  Etiqueta
                </Button>
              )}
            </div>
            {lerRastreio && <LeitorCamera aoLer={(c) => { setRastreio(c); setLerRastreio(false); sinal("ok"); }} aoFechar={() => setLerRastreio(false)} />}
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1 size-4" checked={notificar} onChange={(e) => setNotificar(e.target.checked)} />
              <span>Pedir à loja que avise a cliente por e-mail com o rastreio</span>
            </label>
            <Button type="button" disabled={enviando || !rastreioOk} onClick={enviar}>
              {enviando ? "Marcando…" : "Marcar como enviado"}
            </Button>
          </>
        )}
        {erro && (
          <p role="alert" className="text-sm text-danger">
            {erro}
          </p>
        )}
      </div>
    </div>
  );
}
