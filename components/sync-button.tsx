"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

interface SyncResponse {
  done?: boolean;
  error?: string;
  run?: { tipo: string; totais: { products: number; variants: number; pages: number } };
}

export function SyncButton({ disabled, label = "Sincronizar agora" }: { disabled?: boolean; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function run(tipo: "auto" | "full") {
    setBusy(true);
    setFailed(false);
    setMessage("Iniciando…");
    try {
      // Cada chamada processa um lote curto; repete até concluir (retomável).
      for (let i = 0; i < 200; i++) {
        const res = await fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tipo }),
        });
        const data = (await res.json()) as SyncResponse;
        if (!res.ok || data.error) throw new Error(data.error ?? "Falha ao sincronizar.");
        const t = data.run?.totais;
        setMessage(t ? `Sincronizando… ${t.products} produtos, ${t.variants} variantes` : "Sincronizando…");
        if (data.done) {
          setMessage(t ? `Concluído: ${t.products} produtos e ${t.variants} variantes.` : "Concluído.");
          router.refresh();
          return;
        }
      }
      throw new Error("A sincronização continua em andamento. Tente novamente para retomar.");
    } catch (err) {
      setFailed(true);
      setMessage(err instanceof Error ? err.message : "Falha ao sincronizar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => run("auto")} disabled={busy || disabled}>
          {busy ? "Sincronizando…" : label}
        </Button>
        <Button variant="outline" onClick={() => run("full")} disabled={busy || disabled}>
          Sync completo
        </Button>
      </div>
      {message && (
        <p role={failed ? "alert" : "status"} className={`text-sm ${failed ? "text-danger" : "text-muted"}`}>
          {message}
        </p>
      )}
    </div>
  );
}
