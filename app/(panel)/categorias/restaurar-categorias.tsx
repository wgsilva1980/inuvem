"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function RestaurarCategorias({ quantas }: { quantas: number }) {
  const router = useRouter();
  const [rodando, setRodando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function restaurar() {
    if (!window.confirm(`Restaurar na loja o nome, o endereço, a descrição e a categoria pai de ${quantas} categoria(s)? O SEO atual delas é mantido.`)) return;
    setRodando(true);
    setErro(null);
    setMsg(null);
    try {
      const res = await fetch("/api/categorias/restaurar", { method: "POST" });
      const d = (await res.json()) as { error?: string; restauradas?: number; falhas?: Array<{ nome: string; mensagem: string }> };
      if (!res.ok || d.error) throw new Error(d.error ?? "Falha ao restaurar.");
      setMsg(`${d.restauradas ?? 0} categoria(s) restaurada(s).${d.falhas?.length ? ` Com erro: ${d.falhas.slice(0, 4).map((f) => `${f.nome}: ${f.mensagem}`).join(" · ")}` : ""}`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao restaurar.");
    } finally {
      setRodando(false);
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-2" role="status" aria-live="polite">
      <Button type="button" onClick={restaurar} disabled={rodando}>
        {rodando ? "Restaurando…" : `Restaurar ${quantas} categoria(s)`}
      </Button>
      {msg && <p className="text-sm">{msg}</p>}
      {erro && (
        <p role="alert" className="text-sm text-danger">
          {erro}
        </p>
      )}
    </div>
  );
}
