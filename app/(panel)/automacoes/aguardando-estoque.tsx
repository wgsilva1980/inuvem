"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { manterDespublicadoAction } from "./actions";

export interface LinhaEspera {
  product_id: string;
  produto: string;
  desde: string;
  manter: boolean;
  comEstoque: boolean;
}

/** Lista dos produtos despublicados pela regra: marcar "manter despublicado" e republicar agora os que já têm estoque. */
export function AguardandoEstoque({ linhas }: { linhas: LinhaEspera[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rodando, setRodando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const prontos = linhas.filter((l) => l.comEstoque && !l.manter).length;

  function alternar(l: LinhaEspera) {
    setErro(null);
    start(async () => {
      const r = await manterDespublicadoAction(Number(l.product_id), !l.manter);
      if (!r.ok) setErro(r.message ?? "Falha ao salvar.");
      router.refresh();
    });
  }

  async function republicar() {
    if (!window.confirm(`Publicar de novo agora ${prontos} produto(s) que voltaram a ter estoque? Cada um é conferido na loja antes.`)) return;
    setRodando(true);
    setErro(null);
    setMsg(null);
    let republicados = 0;
    let semEstoque = 0;
    const falhas: string[] = [];
    const ignorar: string[] = [];
    try {
      for (let i = 0; i < 2000; i++) {
        const res = await fetch("/api/automacoes/republicar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ignorar }) });
        const d = (await res.json()) as { error?: string; republicados?: number; semEstoque?: number; falhas?: Array<{ productId: string; produto: string; mensagem: string }>; restantes?: boolean };
        if (!res.ok || d.error) throw new Error(d.error ?? "Falha ao publicar.");
        republicados += d.republicados ?? 0;
        semEstoque += d.semEstoque ?? 0;
        for (const f of d.falhas ?? []) {
          ignorar.push(f.productId);
          falhas.push(`${f.produto}: ${f.mensagem}`);
        }
        setMsg(`${republicados} publicado(s)…`);
        if (!d.restantes) break;
      }
      setMsg(`Pronto: ${republicados} produto(s) publicado(s)${semEstoque ? `; ${semEstoque} já estavam sem estoque na loja e ficaram como estão` : ""}.${falhas.length ? ` Com erro: ${falhas.slice(0, 5).join(" · ")}` : ""}`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao publicar.");
    } finally {
      setRodando(false);
      router.refresh();
    }
  }

  if (linhas.length === 0) return <p className="text-sm text-muted">Nenhum produto esperando: a regra “sem estoque” ainda não despublicou nenhum (ou já voltaram).</p>;
  return (
    <div className="flex flex-col gap-3" role="status" aria-live="polite">
      <ul className="flex flex-col divide-y divide-border text-sm">
        {linhas.map((l) => (
          <li key={l.product_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
            <Link href={`/produtos/${l.product_id}`} className="font-medium hover:underline">
              {l.produto}
            </Link>
            {l.comEstoque ? <Badge tone="success">Estoque voltou</Badge> : <Badge>Sem estoque</Badge>}
            <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs">
              <input type="checkbox" className="h-4 w-4" checked={l.manter} disabled={pending} onChange={() => alternar(l)} />
              Manter despublicado
            </label>
          </li>
        ))}
      </ul>
      <div>
        <Button type="button" variant="outline" disabled={rodando || prontos === 0} onClick={republicar}>
          {rodando ? "Publicando… (mantenha a página aberta)" : `Publicar agora os ${prontos} com estoque`}
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
