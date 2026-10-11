"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export interface ItemVista {
  id: string;
  rotulo: string;
  quando: string;
  ator: string;
  nome: string;
  link: string | null;
  mudancas: Array<{ campo: string; agora: string; volta: string }>;
  estado: "ok" | "mudou" | "sem_item";
}

export function Lista({ itens }: { itens: ItemVista[] }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  async function desfazer(i: ItemVista) {
    if (!confirm(`Desfazer a alteração em “${i.nome}”? O valor de antes será enviado à loja agora.`)) return;
    setOcupado(i.id);
    setMsg(null);
    try {
      const res = await fetch("/api/desfazer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: i.id }) });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Não foi possível desfazer.");
      setMsg({ ok: true, texto: `Desfeito: ${i.nome}.` });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, texto: e instanceof Error ? e.message : "Falha ao desfazer." });
    } finally {
      setOcupado(null);
    }
  }

  if (itens.length === 0) {
    return (
      <Card>
        <p className="text-sm text-muted">Nenhuma alteração recente para desfazer.</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={`rounded-md border border-border bg-card p-3 text-sm ${msg.ok ? "text-success" : "text-danger"}`}>
          {msg.texto}
        </p>
      )}
      {itens.map((i) => (
        <Card key={i.id} className="flex flex-col gap-2 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{i.link ? <Link href={i.link} className="hover:underline">{i.nome}</Link> : i.nome}</span>
              <Badge>{i.rotulo}</Badge>
              {i.estado === "mudou" && <Badge tone="warning">Alterado depois</Badge>}
              {i.estado === "sem_item" && <Badge tone="neutral">Item não existe mais</Badge>}
            </div>
            <span className="text-xs text-muted">
              {i.quando} · {i.ator}
            </span>
          </div>
          <ul className="flex flex-col gap-0.5">
            {i.mudancas.map((m) => (
              <li key={m.campo}>
                <span className="text-muted">{m.campo}:</span> {m.agora} <span className="text-muted">→ volta para</span> <span className="font-medium">{m.volta}</span>
              </li>
            ))}
          </ul>
          {i.estado === "mudou" && <p className="text-xs text-muted">Esse valor já mudou desde então. Para não passar por cima da alteração mais recente, desfaça primeiro a mais nova.</p>}
          <div>
            <Button type="button" variant="outline" onClick={() => desfazer(i)} disabled={ocupado !== null || i.estado !== "ok"} className="min-h-11">
              {ocupado === i.id ? "Desfazendo…" : "Desfazer"}
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
