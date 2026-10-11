"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function VerificarAgora() {
  const router = useRouter();
  const [rodando, setRodando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function verificar() {
    setRodando(true);
    setErro(null);
    try {
      const res = await fetch("/api/vigia", { method: "POST" });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? "Não foi possível verificar.");
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao verificar.");
    } finally {
      setRodando(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="outline" onClick={verificar} disabled={rodando}>
        {rodando ? "Verificando…" : "Verificar agora"}
      </Button>
      {erro && (
        <span role="alert" className="text-sm text-danger">
          {erro}
        </span>
      )}
    </div>
  );
}
