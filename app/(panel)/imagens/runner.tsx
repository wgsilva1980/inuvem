"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Chama o passo do servidor repetidamente até medir todas as imagens. Retomável: as medidas ficam no banco. */
export function AuditRunner({ total, medidas }: { total: number; medidas: number }) {
  const router = useRouter();
  const [rodando, setRodando] = useState(false);
  const [progresso, setProgresso] = useState<{ total: number; medidas: number } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function rodar(todas: boolean) {
    setRodando(true);
    setErro(null);
    setProgresso(todas ? { total, medidas: 0 } : { total, medidas });
    try {
      for (let i = 0; i < 2000; i++) {
        const res = await fetch("/api/images/audit/step", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ todas: todas && i === 0 }),
        });
        const data = (await res.json()) as { error?: string; restantes?: boolean; total?: number; medidas?: number };
        if (!res.ok || data.error) throw new Error(data.error ?? "Falha ao analisar as imagens.");
        setProgresso({ total: data.total ?? total, medidas: data.medidas ?? 0 });
        if (!data.restantes) break;
      }
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao analisar as imagens.");
    } finally {
      setRodando(false);
      router.refresh();
    }
  }

  const feitas = progresso?.medidas ?? medidas;
  const alvo = progresso?.total ?? total;
  const pct = alvo === 0 ? 100 : Math.round((feitas / alvo) * 100);
  const pendentes = total - medidas;
  return (
    <div className="flex flex-col gap-3" role="status" aria-live="polite">
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={rodando || total === 0} onClick={() => rodar(false)}>
          {rodando ? "Analisando…" : pendentes > 0 ? `Analisar imagens (${pendentes} faltando)` : "Analisar novas imagens"}
        </Button>
        <Button type="button" variant="outline" disabled={rodando || total === 0} onClick={() => rodar(true)}>
          Reanalisar tudo
        </Button>
      </div>
      {(rodando || progresso) && (
        <>
          <div className="h-2 w-full overflow-hidden rounded bg-border" aria-hidden>
            <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-sm">
            {feitas} de {alvo} imagens analisadas.{rodando ? " Mantenha esta página aberta; se fechar, é só voltar e continuar." : ""}
          </p>
        </>
      )}
      {erro && (
        <p role="alert" className="text-sm text-danger">
          {erro}
        </p>
      )}
    </div>
  );
}
