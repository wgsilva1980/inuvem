"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Auditoria das fotos deste produto: mede tamanho, proporção, peso e formato de cada foto (só leitura, nada muda na loja) e atualiza o item
 * “Fotos no padrão da loja” do checklist. A medição é a mesma da página Imagens, só que limitada a este produto.
 */
export function AuditarFotos({ productId, total, medidas }: { productId: number; total: number; medidas: number }) {
  const router = useRouter();
  const [rodando, setRodando] = useState(false);
  const [progresso, setProgresso] = useState<{ total: number; medidas: number } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState(false);

  async function rodar(todas: boolean) {
    setRodando(true);
    setErro(null);
    setFeito(false);
    setProgresso({ total, medidas: todas ? 0 : medidas });
    try {
      for (let i = 0; i < 50; i++) {
        const res = await fetch("/api/images/audit/step", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ produtoId: productId, todas: todas && i === 0 }),
        });
        const d = (await res.json()) as { error?: string; restantes?: boolean; total?: number; medidas?: number };
        if (!res.ok || d.error) throw new Error(d.error ?? "Falha ao analisar as fotos.");
        setProgresso({ total: d.total ?? total, medidas: d.medidas ?? 0 });
        if (!d.restantes) break;
      }
      setFeito(true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao analisar as fotos.");
    } finally {
      setRodando(false);
      router.refresh();
    }
  }

  const pendentes = total - medidas;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm" role="status" aria-live="polite">
      <p className="text-muted">
        {total === 0
          ? "Este produto ainda não tem fotos para analisar."
          : pendentes > 0
            ? `${medidas} de ${total} ${total === 1 ? "foto analisada" : "fotos analisadas"} (tamanho, proporção, peso e formato).`
            : `Todas as ${total} ${total === 1 ? "foto foi analisada" : "fotos foram analisadas"}.`}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" className="min-h-9" disabled={rodando || total === 0} onClick={() => rodar(false)}>
          {rodando ? "Analisando…" : pendentes > 0 ? `Analisar fotos (${pendentes} faltando)` : "Analisar fotos novas"}
        </Button>
        <Button type="button" variant="outline" className="min-h-9" disabled={rodando || total === 0} onClick={() => rodar(true)}>
          Reanalisar todas
        </Button>
      </div>
      {rodando && progresso && (
        <p className="text-xs text-muted">
          {progresso.medidas} de {progresso.total} analisadas. Mantenha a página aberta.
        </p>
      )}
      {feito && !erro && <p className="text-xs text-muted">Análise concluída. O checklist foi atualizado.</p>}
      {erro && (
        <p role="alert" className="text-xs text-danger">
          {erro}
        </p>
      )}
    </div>
  );
}
