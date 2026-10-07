"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Aplica a regra agora aos produtos que já estão publicados sem estoque (em passos, retomável). */
export function DespublicarAgora({ quantos }: { quantos: number }) {
  const router = useRouter();
  const [rodando, setRodando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function rodar() {
    if (!window.confirm(`Despublicar agora ${quantos} produto(s) que estão publicados com todas as variações sem estoque? Cada um é conferido na loja antes e o campo “Publicado na loja” vira falso. Dá para publicar de novo depois.`)) return;
    setRodando(true);
    setErro(null);
    let despublicados = 0;
    let jaOk = 0;
    const falhas: string[] = [];
    const ignorar: string[] = [];
    try {
      for (let i = 0; i < 2000; i++) {
        const res = await fetch("/api/automacoes/despublicar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ignorar }) });
        const data = (await res.json()) as { error?: string; despublicados?: number; jaOk?: number; falhas?: Array<{ productId: string; produto: string; mensagem: string }>; restantes?: boolean };
        if (!res.ok || data.error) throw new Error(data.error ?? "Falha ao despublicar.");
        despublicados += data.despublicados ?? 0;
        jaOk += data.jaOk ?? 0;
        for (const f of data.falhas ?? []) {
          ignorar.push(f.productId);
          falhas.push(`${f.produto}: ${f.mensagem}`);
        }
        setMsg(`${despublicados} despublicado(s)…`);
        if (!data.restantes) break;
      }
      setMsg(`Pronto: ${despublicados} produto(s) despublicado(s)${jaOk ? `; ${jaOk} já estavam com estoque na loja e foram mantidos` : ""}.${falhas.length ? ` Com erro: ${falhas.slice(0, 5).join(" · ")}` : ""}`);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao despublicar.");
    } finally {
      setRodando(false);
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-2" role="status" aria-live="polite">
      <div>
        <Button type="button" variant="outline" disabled={rodando || quantos === 0} onClick={rodar}>
          {rodando ? "Despublicando… (mantenha a página aberta)" : `Despublicar agora os ${quantos} sem estoque`}
        </Button>
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
