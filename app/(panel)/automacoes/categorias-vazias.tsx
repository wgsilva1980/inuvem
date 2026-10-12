"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { salvarCategoriasVaziasAction, type AutomacaoState } from "./actions";

export function CategoriasVaziasForm({ ligado }: { ligado: boolean }) {
  const [state, action, pending] = useActionState<AutomacaoState | null, FormData>(salvarCategoriasVaziasAction, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="auto_categorias" defaultChecked={ligado} className="mt-1 h-4 w-4" />
        <span>
          <strong>Ocultar a categoria que não tem nenhum produto publicado e mostrá-la de novo quando voltar um</strong>
          <br />
          <span className="text-muted">Vale quando a Nuvemshop avisa o painel de uma mudança num produto (publicar, despublicar, trocar de categoria, apagar) e uma vez por dia.</span>
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Salvando…" : "Salvar"}
        </Button>
        {state?.message && (
          <span role={state.ok ? "status" : "alert"} className={`text-sm ${state.ok ? "text-success" : "text-danger"}`}>
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}

interface Resposta {
  error?: string;
  ocultadas?: number;
  exibidas?: number;
  restantes?: number;
  falhas?: Array<{ categoria: string; mensagem: string }>;
}

/** Aplica a regra agora, mesmo com a opção desligada; repete enquanto sobrar categoria a ocultar (a cada chamada o servidor trata poucas). */
export function CategoriasVaziasAgora({ ocultar, exibir }: { ocultar: number; exibir: number }) {
  const router = useRouter();
  const [rodando, setRodando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const total = ocultar + exibir;

  async function rodar() {
    const partes = [ocultar > 0 ? `ocultar ${ocultar} categoria(s) sem produto publicado` : null, exibir > 0 ? `mostrar de novo ${exibir} categoria(s) que a regra tinha ocultado` : null].filter(Boolean);
    if (!window.confirm(`Agora: ${partes.join(" e ")}? Cada categoria é conferida na loja antes. Só muda a visibilidade (nome, endereço e produtos ficam como estão).`)) return;
    setRodando(true);
    setErro(null);
    setMsg(null);
    let ocultadas = 0;
    let exibidas = 0;
    const falhas: string[] = [];
    try {
      for (let i = 0; i < 20; i++) {
        const res = await fetch("/api/automacoes/categorias", { method: "POST" });
        const d = (await res.json()) as Resposta;
        if (!res.ok || d.error) throw new Error(d.error ?? "Falha ao aplicar a regra.");
        ocultadas += d.ocultadas ?? 0;
        exibidas += d.exibidas ?? 0;
        for (const f of d.falhas ?? []) falhas.push(`${f.categoria}: ${f.mensagem}`);
        setMsg(`${ocultadas} oculta(s), ${exibidas} mostrada(s)…`);
        if (!(d.restantes ?? 0) || (d.falhas?.length ?? 0) > 0 || (d.ocultadas ?? 0) === 0) break;
      }
      setMsg(`Pronto: ${ocultadas} categoria(s) oculta(s) e ${exibidas} mostrada(s) de novo.${falhas.length ? ` Com problema: ${falhas.slice(0, 4).join(" · ")}` : ""}`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao aplicar a regra.");
    } finally {
      setRodando(false);
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-2" role="status" aria-live="polite">
      <div>
        <Button type="button" variant="outline" disabled={rodando || total === 0} onClick={rodar}>
          {rodando ? "Aplicando… (mantenha a página aberta)" : total === 0 ? "Nada a fazer agora" : "Aplicar agora"}
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
