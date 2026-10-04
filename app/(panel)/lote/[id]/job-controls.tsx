"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cancelBulk, revertBulk, startBulk } from "../actions";

interface Counts {
  total: number;
  pending: number;
  ok: number;
  error: number;
  conflict: number;
}

/** Em execução: chama o passo do servidor repetidamente até terminar. Se a página for recarregada, retoma de onde parou. */
function Runner({ jobId, initial }: { jobId: string; initial: Counts }) {
  const router = useRouter();
  const [counts, setCounts] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const running = useRef(false);

  useEffect(() => {
    if (running.current) return;
    running.current = true;
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        for (let i = 0; i < 5000 && !cancelled; i++) {
          const res = await fetch(`/api/bulk/${jobId}/step`, { method: "POST" });
          const data = (await res.json()) as { done?: boolean; error?: string; counts?: Counts };
          if (!res.ok || data.error) throw new Error(data.error ?? "Falha ao processar o lote.");
          if (data.counts) setCounts(data.counts);
          if (data.done) break;
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Falha ao processar o lote.");
      } finally {
        running.current = false;
        if (!cancelled) router.refresh();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId, router, attempt]);

  const done = counts.total - counts.pending;
  const pct = counts.total === 0 ? 100 : Math.round((done / counts.total) * 100);
  return (
    <div className="flex flex-col gap-2" role="status" aria-live="polite">
      <div className="h-2 w-full overflow-hidden rounded bg-border" aria-hidden>
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-sm">
        Aplicando… {done} de {counts.total} produtos ({counts.ok} ok{counts.error ? `, ${counts.error} com erro` : ""}
        {counts.conflict ? `, ${counts.conflict} em conflito` : ""}). Mantenha esta página aberta; se fechar, é só voltar para continuar.
      </p>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}{" "}
          <button type="button" className="underline" onClick={() => setAttempt((a) => a + 1)}>
            Tentar continuar
          </button>
        </p>
      )}
    </div>
  );
}

export function JobControls({
  jobId,
  status,
  counts,
  produtos,
  variantes,
  canRevert,
  descricao,
}: {
  jobId: string;
  status: "preview" | "running" | "completed" | "cancelled";
  counts: Counts;
  produtos: number;
  variantes: number;
  canRevert: boolean;
  descricao: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const act = (task: () => Promise<{ ok: boolean; message?: string }>) =>
    startTransition(async () => {
      const r = await task();
      if (!r.ok) setMessage(r.message ?? "Não foi possível concluir a ação.");
      else {
        setMessage(null);
        router.refresh();
      }
    });

  return (
    <div className="flex flex-col gap-3">
      {status === "running" && <Runner jobId={jobId} initial={counts} />}

      <div className="flex flex-wrap gap-2">
        {status === "preview" && (
          <Button
            type="button"
            disabled={pending}
            onClick={() => {
              if (window.confirm(`Aplicar na loja agora?\n\n${descricao}\n${produtos} produto(s), ${variantes} variante(s) alterada(s).\n\nVocê poderá reverter depois, desde que a loja não mude nesse intervalo.`)) act(() => startBulk(jobId));
            }}
          >
            Aplicar na loja
          </Button>
        )}
        {(status === "preview" || status === "running") && (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => {
              if (status === "preview" || window.confirm("Parar este lote? O que já foi aplicado continua na loja (você pode reverter).")) act(() => cancelBulk(jobId));
            }}
          >
            {status === "preview" ? "Descartar" : "Parar lote"}
          </Button>
        )}
        {canRevert && (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => {
              if (window.confirm("Criar um lote que desfaz este?\n\nVocê verá a pré-visualização antes de aplicar.")) act(() => revertBulk(jobId));
            }}
          >
            Reverter este lote
          </Button>
        )}
      </div>
      {message && (
        <p role="alert" className="text-sm text-danger">
          {message}
        </p>
      )}
    </div>
  );
}
