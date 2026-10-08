"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { descartarRascunhoAction } from "../novo/rascunhos-actions";

export function DescartarRascunho({ id }: { id: number }) {
  const router = useRouter();
  const [pendente, comecar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function descartar() {
    if (!window.confirm("Descartar este rascunho? Os campos e as fotos guardadas serão apagados.")) return;
    comecar(async () => {
      const r = await descartarRascunhoAction(id);
      if (r.ok) router.refresh();
      else setErro(r.message ?? "Não foi possível descartar.");
    });
  }

  return (
    <>
      <Button type="button" variant="outline" disabled={pendente} onClick={descartar}>
        {pendente ? "Descartando…" : "Descartar"}
      </Button>
      {erro && (
        <span role="alert" className="text-xs text-danger">
          {erro}
        </span>
      )}
    </>
  );
}
