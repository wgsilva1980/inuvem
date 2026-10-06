"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { DESCRICAO_MAX, TITULO_MAX } from "@/lib/seo/text";
import { aplicarSeoAction, type SeoState } from "./actions";

/** Título e descrição de SEO sugeridos: editáveis, com contador, e gravação no produto. */
export function SeoEditor({ productId, titulo, descricao, aplicado }: { productId: number; titulo: string; descricao: string; aplicado: boolean }) {
  const [state, action, pending] = useActionState<SeoState | null, FormData>(aplicarSeoAction.bind(null, productId), null);
  const [t, setT] = useState(titulo);
  const [d, setD] = useState(descricao);
  const editado = t !== titulo || d !== descricao;
  const estourou = t.length > TITULO_MAX || d.length > DESCRICAO_MAX;
  const contador = (n: number, max: number) => <span className={n > max ? "text-danger" : "text-muted"}>{n}/{max}</span>;
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="editado" value={editado ? "1" : "0"} />
      <label className="flex flex-col gap-1 text-xs text-muted">
        <span className="flex justify-between">Título sugerido {contador(t.length, TITULO_MAX)}</span>
        <input name="titulo" value={t} onChange={(e) => setT(e.target.value)} className="min-h-10 rounded-md border border-border-strong bg-card px-3 text-sm text-foreground" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        <span className="flex justify-between">Descrição sugerida {contador(d.length, DESCRICAO_MAX)}</span>
        <textarea name="descricao" value={d} onChange={(e) => setD(e.target.value)} rows={3} className="rounded-md border border-border-strong bg-card px-3 py-2 text-sm text-foreground" />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="outline" disabled={pending || estourou}>
          {pending ? "Gravando…" : aplicado && !editado ? "Gravar de novo na loja" : "Gravar na loja"}
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
