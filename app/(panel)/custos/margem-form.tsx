"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { fieldBase } from "@/components/ui/field";
import { salvarMargemAction, type CustosState } from "./actions";

export function MargemForm({ margem }: { margem: number }) {
  const [state, action, pending] = useActionState<CustosState | null, FormData>(salvarMargemAction, null);
  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Margem mínima sobre o preço de venda (%)</span>
          <input name="margem" inputMode="decimal" defaultValue={String(margem).replace(".", ",")} className={`${fieldBase} w-28`} />
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? "Salvando…" : "Salvar"}
        </Button>
      </div>
      <p className="text-xs text-muted">Com custo informado, lotes, promoções e a liquidação não baixam o preço abaixo do custo mais esta margem. Em 0%, só impede vender abaixo do custo. Subir o preço nunca é barrado.</p>
      {state?.message && (
        <p role={state.ok ? "status" : "alert"} className={`text-sm ${state.ok ? "text-success" : "text-danger"}`}>
          {state.message}
        </p>
      )}
    </form>
  );
}
