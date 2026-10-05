"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

interface Passo {
  error?: string;
  fotos?: number;
  produtos?: number[];
  falhas?: Array<{ productId: number; nome: string; mensagem: string }>;
  restantes?: boolean;
  restauradas?: number;
  ignoradas?: number;
  falhasDesfazer?: string[];
}

async function chamar(corpo: Record<string, unknown>): Promise<Passo> {
  const res = await fetch("/api/images/standardize/step", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
  const data = (await res.json()) as Passo;
  if (!res.ok || data.error) throw new Error(data.error ?? "Falha ao padronizar as imagens.");
  return data;
}

/** Padroniza em passos (a tela chama o servidor até acabar). `produtoId` = só um produto; sem ele, todos os pendentes. */
export function StandardizeRunner({ produtoId, pendentes, rotulo, desfazer }: { produtoId?: number; pendentes: number; rotulo: string; desfazer?: boolean }) {
  const router = useRouter();
  const [rodando, setRodando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function padronizar() {
    const alvo = produtoId ? "as fotos deste produto" : `${pendentes} produto(s)`;
    if (!window.confirm(`Padronizar ${alvo}? Cada foto original é copiada para o armazenamento antes de ser trocada na loja; dá para desfazer por produto.`)) return;
    setRodando(true);
    setErro(null);
    let fotos = 0;
    const falhos: number[] = [];
    const textoFalhas: string[] = [];
    try {
      for (let i = 0; i < 3000; i++) {
        const r = await chamar({ produtoId, ignorar: falhos });
        fotos += r.fotos ?? 0;
        for (const f of r.falhas ?? []) {
          falhos.push(f.productId);
          textoFalhas.push(`${f.nome}: ${f.mensagem}`);
        }
        setMsg(`${fotos} foto(s) padronizada(s)…${textoFalhas.length ? ` ${textoFalhas.length} produto(s) com erro.` : ""}`);
        if (!r.restantes) break;
      }
      setMsg(`Pronto: ${fotos} foto(s) padronizada(s).${textoFalhas.length ? ` Com erro: ${textoFalhas.join(" · ")}` : ""} Rode “Analisar novas imagens” para medir o resultado.`);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao padronizar as imagens.");
    } finally {
      setRodando(false);
      router.refresh();
    }
  }

  async function desfazerProduto() {
    if (!window.confirm("Desfazer a padronização deste produto? As cópias guardadas voltam para a loja no lugar das fotos padronizadas.")) return;
    setRodando(true);
    setErro(null);
    try {
      const r = await chamar({ produtoId, desfazer: true });
      const falhas = (r as unknown as { falhas?: string[] }).falhas ?? [];
      setMsg(`${r.restauradas ?? 0} foto(s) restaurada(s).${falhas.length ? ` Com erro: ${falhas.join(" · ")}` : ""}`);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao desfazer.");
    } finally {
      setRodando(false);
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-2" role="status" aria-live="polite">
      <div>
        {desfazer ? (
          <Button type="button" variant="outline" disabled={rodando} onClick={desfazerProduto}>
            {rodando ? "Desfazendo…" : rotulo}
          </Button>
        ) : (
          <Button type="button" variant={produtoId ? "outline" : "primary"} disabled={rodando || pendentes === 0} onClick={padronizar}>
            {rodando ? "Padronizando… (mantenha a página aberta)" : rotulo}
          </Button>
        )}
      </div>
      {msg && <p className="text-sm">{msg}</p>}
      {erro && (
        <p role="alert" className="text-sm text-danger">
          {erro}
        </p>
      )}
    </div>
  );
}
