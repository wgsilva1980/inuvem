"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Copia o texto alternativo para colar no painel da Nuvemshop. */
export function CopyButton({ texto }: { texto: string }) {
  const [estado, setEstado] = useState<"" | "ok" | "erro">("");
  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setEstado("ok");
    } catch {
      setEstado("erro");
    }
    setTimeout(() => setEstado(""), 2500);
  }
  return (
    <span className="flex items-center gap-2">
      <Button type="button" variant="outline" onClick={copiar}>
        Copiar texto
      </Button>
      <span role="status" className="text-xs text-muted">
        {estado === "ok" ? "Copiado." : estado === "erro" ? "Não foi possível copiar; selecione o texto." : ""}
      </span>
    </span>
  );
}
