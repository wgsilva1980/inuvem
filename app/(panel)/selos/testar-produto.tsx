"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { fieldBase } from "@/components/ui/field";

/** Mostra o que a vitrine receberia para um produto (o mesmo pedido que o script faz). */
export function TestarProduto({ nuvemshopStoreId }: { nuvemshopStoreId: string }) {
  const [handle, setHandle] = useState("");
  const [saida, setSaida] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function testar() {
    setOcupado(true);
    try {
      const h = handle.trim().replace(/^.*\/produtos\//, "").replace(/[/?#].*$/, "").toLowerCase();
      const res = await fetch(`/api/loja/selos?s=${encodeURIComponent(nuvemshopStoreId)}&h=${encodeURIComponent(h)}`, { cache: "no-store" });
      const data = (await res.json()) as Record<string, unknown>;
      setSaida(Object.keys(data).length === 0 ? "Nada a mostrar para este produto (selos desligados, produto não publicado, endereço não encontrado ou nenhum selo se aplica)." : JSON.stringify(data, null, 2));
    } catch {
      setSaida("Não foi possível consultar.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="Endereço do produto, ex.: vestido-midi-azul (ou cole o link inteiro)" className={`${fieldBase} flex-1`} />
        <Button type="button" variant="outline" disabled={ocupado || handle.trim() === ""} onClick={testar}>
          {ocupado ? "Consultando…" : "Ver o que a vitrine recebe"}
        </Button>
      </div>
      {saida && <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border p-3 text-xs">{saida}</pre>}
    </div>
  );
}
