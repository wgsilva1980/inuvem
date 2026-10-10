"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

interface ResultadoImportacao {
  atualizados: number;
  ignoradas: Array<{ linha: number; motivo: string }>;
  totalIgnoradas: number;
}

export function Ferramentas({ exportHref }: { exportHref: string }) {
  const router = useRouter();
  const arquivo = useRef<HTMLInputElement>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ignoradas, setIgnoradas] = useState<ResultadoImportacao | null>(null);

  async function lerLoja() {
    setOcupado("loja");
    setErro(null);
    setMsg(null);
    setIgnoradas(null);
    const res = await fetch("/api/custos/ler-loja", { method: "POST" });
    const d = (await res.json().catch(() => ({}))) as { produtos?: number; error?: string };
    setOcupado(null);
    if (!res.ok) return setErro(d.error ?? "Não foi possível ler os custos.");
    setMsg(d.produtos ? `${d.produtos} produto(s) receberam o custo que a loja já tinha.` : "A loja não tem custos novos para trazer (ou os produtos já têm custo aqui).");
    router.refresh();
  }

  async function importar() {
    const f = arquivo.current?.files?.[0];
    if (!f) return;
    setOcupado("importar");
    setErro(null);
    setMsg(null);
    setIgnoradas(null);
    const fd = new FormData();
    fd.set("arquivo", f);
    const res = await fetch("/api/custos/importar", { method: "POST", body: fd });
    const d = (await res.json().catch(() => ({}))) as Partial<ResultadoImportacao> & { error?: string };
    setOcupado(null);
    if (arquivo.current) arquivo.current.value = "";
    if (!res.ok) return setErro(d.error ?? "Não foi possível importar.");
    setMsg(`${d.atualizados ?? 0} custo(s) atualizado(s)${d.totalIgnoradas ? `, ${d.totalIgnoradas} linha(s) ignorada(s)` : ""}.`);
    if (d.totalIgnoradas) setIgnoradas(d as ResultadoImportacao);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <a href={exportHref} download className="inline-flex min-h-10 items-center rounded-md border border-border-strong px-4 py-2 text-sm font-medium hover:bg-border/40">
          Baixar planilha para preencher
        </a>
        <label className="inline-flex min-h-10 cursor-pointer items-center rounded-md border border-border-strong px-4 py-2 text-sm font-medium hover:bg-border/40">
          {ocupado === "importar" ? "Importando…" : "Importar planilha (.xlsx ou .csv)"}
          <input ref={arquivo} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" disabled={ocupado !== null} onChange={importar} />
        </label>
        <Button type="button" variant="outline" disabled={ocupado !== null} onClick={lerLoja}>
          {ocupado === "loja" ? "Lendo…" : "Trazer custos que a loja já tem"}
        </Button>
      </div>
      <p className="text-xs text-muted">A planilha precisa das colunas “ID” ou “SKU” e “Custo”. Linha com custo vazio é pulada e nada é apagado. Os custos ficam só no painel; nada é enviado à loja.</p>
      {msg && <p role="status" className="text-sm text-success">{msg}</p>}
      {erro && <p role="alert" className="text-sm text-danger">{erro}</p>}
      {ignoradas && (
        <details className="text-sm" open>
          <summary className="cursor-pointer text-muted">Linhas ignoradas ({ignoradas.totalIgnoradas})</summary>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {ignoradas.ignoradas.map((i) => (
              <li key={`${i.linha}-${i.motivo}`}>Linha {i.linha}: {i.motivo}</li>
            ))}
            {ignoradas.totalIgnoradas > ignoradas.ignoradas.length && <li>…e mais {ignoradas.totalIgnoradas - ignoradas.ignoradas.length}.</li>}
          </ul>
        </details>
      )}
    </div>
  );
}
