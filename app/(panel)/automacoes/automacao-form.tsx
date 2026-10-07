"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { salvarAutomacaoAction, type AutomacaoState } from "./actions";

export function AutomacaoForm({ ligado }: { ligado: boolean }) {
  const [state, action, pending] = useActionState<AutomacaoState | null, FormData>(salvarAutomacaoAction, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="auto_despublicar" defaultChecked={ligado} className="mt-1 h-4 w-4" />
        <span>
          <strong>Despublicar automaticamente o produto quando todas as variações ficarem sem estoque</strong>
          <br />
          <span className="text-muted">Vale quando a Nuvemshop avisa o painel de uma atualização do produto (por exemplo, depois de uma venda ou de uma edição de estoque).</span>
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
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
