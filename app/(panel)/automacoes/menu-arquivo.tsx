"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { salvarMenuArquivoAction, type AutomacaoState } from "./actions";

export function MenuArquivoForm({ ligado, configurado }: { ligado: boolean; configurado: boolean }) {
  const [state, action, pending] = useActionState<AutomacaoState | null, FormData>(salvarMenuArquivoAction, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="auto_menu" defaultChecked={ligado} disabled={!configurado} className="mt-1 h-4 w-4" />
        <span>
          <strong>Enviar o arquivo por FTP sozinho sempre que uma categoria for ocultada ou mostrada</strong>
          <br />
          <span className="text-muted">Também confere uma vez por dia. Só envia quando o conteúdo do arquivo mudou.</span>
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || !configurado}>
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

/** Enviar agora, voltar à versão anterior e baixar o arquivo gerado. */
export function MenuArquivoAcoes({ configurado, temAnterior }: { configurado: boolean; temAnterior: boolean }) {
  const router = useRouter();
  const [rodando, setRodando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function rodar(acao: "enviar" | "restaurar") {
    if (acao === "restaurar" && !window.confirm("Voltar o arquivo do menu para a versão anterior ao último envio? Ela é enviada por FTP agora.")) return;
    setRodando(true);
    setErro(null);
    setMsg(null);
    try {
      const res = await fetch("/api/menu/enviar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ acao }) });
      const d = (await res.json()) as { error?: string; estado?: string; caminhos?: number };
      if (!res.ok || d.error) throw new Error(d.error ?? "Falha ao enviar.");
      setMsg(acao === "enviar" ? `Arquivo enviado (${d.caminhos ?? 0} categoria(s) oculta(s)). A loja pode levar alguns minutos para refletir, por causa do cache.` : "Versão anterior enviada.");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao enviar.");
    } finally {
      setRodando(false);
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-2" role="status" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" disabled={rodando || !configurado} onClick={() => rodar("enviar")}>
          {rodando ? "Enviando…" : "Enviar agora"}
        </Button>
        <Button type="button" variant="outline" disabled={rodando || !configurado || !temAnterior} onClick={() => rodar("restaurar")}>
          Voltar à versão anterior
        </Button>
        <a href="/api/menu/arquivo" className={buttonClass("outline")}>
          Baixar o arquivo
        </a>
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
