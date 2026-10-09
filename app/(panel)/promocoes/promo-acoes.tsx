"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cancelarPromocao } from "./actions";

interface Counts {
  total: number;
  pending: number;
  ok: number;
  error: number;
  conflict: number;
}
interface Passo {
  error?: string;
  status: string;
  done: boolean;
  counts: Counts | null;
}

/** Botões da promoção. Enquanto aplica ou encerra, repete o passo do servidor até terminar (se a página fechar, é só voltar). */
export function PromoAcoes({ id, status, nome }: { id: string; status: string; nome: string }) {
  const router = useRouter();
  const [rodando, setRodando] = useState(status === "aplicando" || status === "encerrando");
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const acaoPendente = useRef<"iniciar" | "encerrar" | undefined>(undefined);
  const ocupado = useRef(false);

  useEffect(() => {
    if (!rodando || ocupado.current) return;
    ocupado.current = true;
    let cancelado = false;
    (async () => {
      setErro(null);
      try {
        for (let i = 0; i < 5000 && !cancelado; i++) {
          const acao = acaoPendente.current;
          acaoPendente.current = undefined;
          const res = await fetch(`/api/promocoes/${id}/passo`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ acao }) });
          const d = (await res.json()) as Passo;
          if (!res.ok || d.error) throw new Error(d.error ?? "Falha ao processar a promoção.");
          if (d.counts) setMsg(`${d.counts.total - d.counts.pending} de ${d.counts.total} produtos (${d.counts.ok} ok${d.counts.error + d.counts.conflict ? `, ${d.counts.error + d.counts.conflict} com problema` : ""})…`);
          if (d.done) break;
        }
      } catch (e) {
        if (!cancelado) setErro(e instanceof Error ? e.message : "Falha ao processar a promoção.");
      } finally {
        ocupado.current = false;
        if (!cancelado) {
          setRodando(false);
          router.refresh();
        }
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [rodando, id, router, tentativa]);

  function disparar(acao: "iniciar" | "encerrar", pergunta: string) {
    if (!window.confirm(pergunta)) return;
    acaoPendente.current = acao;
    setRodando(true);
  }

  async function cancelar() {
    if (!window.confirm(`Cancelar a promoção “${nome}”? Nada foi alterado na loja.`)) return;
    const r = await cancelarPromocao(id);
    if (!r.ok) setErro(r.message ?? "Não foi possível cancelar.");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2" role="status" aria-live="polite">
      <div className="flex flex-wrap gap-2">
        {status === "agendada" && (
          <>
            <Button type="button" disabled={rodando} onClick={() => disparar("iniciar", `Iniciar agora a promoção “${nome}”? Os preços promocionais serão gravados na loja agora.`)}>
              Iniciar agora
            </Button>
            <Button type="button" variant="outline" disabled={rodando} onClick={cancelar}>
              Cancelar promoção
            </Button>
          </>
        )}
        {status === "ativa" && (
          <Button type="button" variant="outline" disabled={rodando} onClick={() => disparar("encerrar", `Encerrar agora a promoção “${nome}”? Os preços promocionais voltam ao que eram antes.`)}>
            Encerrar agora
          </Button>
        )}
        {erro && !rodando && (status === "aplicando" || status === "encerrando") && (
          <Button type="button" variant="outline" onClick={() => { setRodando(true); setTentativa((t) => t + 1); }}>
            Tentar continuar
          </Button>
        )}
      </div>
      {rodando && <p className="text-sm">{status === "encerrando" || acaoPendente.current === "encerrar" ? "Restaurando os preços…" : "Aplicando…"} {msg} Mantenha esta página aberta; se fechar, é só voltar para continuar.</p>}
      {erro && (
        <p role="alert" className="text-sm text-danger">
          {erro}
        </p>
      )}
    </div>
  );
}
