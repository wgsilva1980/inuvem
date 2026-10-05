"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

interface PassoRevisao {
  error?: string;
  revisadas?: number;
  erros?: number;
  restantes?: boolean;
  tentadas?: string[];
  revisadasTotal?: number;
  fotos?: number;
}

/** Revisa as fotos com o Claude em passos (retomável). `maxFotos` limita a rodada (para testar com poucas). */
export function ReviewRunner({ fotos, revisadas }: { fotos: number; revisadas: number }) {
  const router = useRouter();
  const [rodando, setRodando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const faltam = Math.max(0, fotos - revisadas);

  async function rodar(maxFotos?: number) {
    if (!window.confirm(maxFotos ? `Revisar ${maxFotos} fotos agora com o Claude? Cada foto usa a API da Anthropic (custo por uso).` : `Revisar ${faltam} fotos com o Claude? Cada foto usa a API da Anthropic (custo por uso); a tela mostra o custo estimado.`)) return;
    setRodando(true);
    setErro(null);
    setMsg(null);
    let total = 0;
    let falhas = 0;
    let tentadas: string[] = [];
    try {
      for (let i = 0; i < 2000; i++) {
        const restanteMax = maxFotos ? maxFotos - total - falhas : undefined;
        if (restanteMax !== undefined && restanteMax <= 0) break;
        const res = await fetch("/api/images/review/step", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ maxFotos: restanteMax, ignorar: tentadas }) });
        const data = (await res.json()) as PassoRevisao;
        if (!res.ok || data.error) throw new Error(data.error ?? "Falha ao revisar as imagens.");
        total += data.revisadas ?? 0;
        falhas += data.erros ?? 0;
        tentadas = data.tentadas ?? tentadas;
        setMsg(`${total} foto(s) revisada(s)${falhas ? `, ${falhas} com erro` : ""}…`);
        if (!data.restantes) break;
      }
      setMsg(`Pronto: ${total} foto(s) revisada(s)${falhas ? `, ${falhas} com erro (tente de novo em 10 minutos)` : ""}.`);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao revisar as imagens.");
    } finally {
      setRodando(false);
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-2" role="status" aria-live="polite">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={rodando || faltam === 0} onClick={() => rodar(10)}>
          Testar com 10 fotos
        </Button>
        <Button type="button" disabled={rodando || faltam === 0} onClick={() => rodar()}>
          {rodando ? "Revisando… (mantenha a página aberta)" : `Revisar todas (${faltam} faltando)`}
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

/** Envia à loja os textos alternativos sugeridos, em passos (retomável). */
export function ApplyAltRunner({ pendentes }: { pendentes: number }) {
  const router = useRouter();
  const [rodando, setRodando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function aplicar() {
    if (!window.confirm(`Enviar ${pendentes} texto(s) alternativo(s) à loja? Só entram fotos que hoje estão sem texto (ou que você editou). Dá para editar qualquer um depois.`)) return;
    setRodando(true);
    setErro(null);
    let aplicados = 0;
    const falhasTexto: string[] = [];
    const ignorar: string[] = [];
    try {
      for (let i = 0; i < 2000; i++) {
        const res = await fetch("/api/images/review/apply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ignorar }) });
        const data = (await res.json()) as { error?: string; aplicados?: number; falhas?: Array<{ imageId: string; mensagem: string }>; restantes?: boolean };
        if (!res.ok || data.error) throw new Error(data.error ?? "Falha ao enviar os textos.");
        aplicados += data.aplicados ?? 0;
        for (const f of data.falhas ?? []) {
          ignorar.push(f.imageId);
          falhasTexto.push(f.mensagem);
        }
        setMsg(`${aplicados} texto(s) enviado(s)…`);
        if (!data.restantes) break;
      }
      setMsg(`Pronto: ${aplicados} texto(s) enviado(s) à loja.${falhasTexto.length ? ` ${falhasTexto.length} com erro: ${[...new Set(falhasTexto)].join(" · ")}` : ""}`);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao enviar os textos.");
    } finally {
      setRodando(false);
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-2" role="status" aria-live="polite">
      <div>
        <Button type="button" disabled={rodando || pendentes === 0} onClick={aplicar}>
          {rodando ? "Enviando…" : `Enviar textos à loja (${pendentes})`}
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
