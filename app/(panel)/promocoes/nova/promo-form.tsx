"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass } from "@/components/ui/field";
import { criarPromocao, type PromoFormState } from "../actions";

export function PromoForm({ selecao, total }: { selecao: string; total: number }) {
  const [state, action, pending] = useActionState<PromoFormState | null, FormData>(criarPromocao, null);
  return (
    <form action={action} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <input type="hidden" name="selecao" value={selecao} />
      <label className="flex flex-col gap-1 text-sm sm:col-span-2">
        <span className="font-medium">Nome da promoção</span>
        <input name="nome" required maxLength={120} placeholder="Ex.: Liquidação de verão" className={fieldClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Desconto (%) sobre o preço</span>
        <input name="percent" required inputMode="decimal" placeholder="15" className={fieldClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Arredondar o preço promocional</span>
        <select name="arredondar" defaultValue="90" className={fieldClass}>
          <option value="nenhum">Sem arredondar</option>
          <option value="90">Terminar em ,90</option>
          <option value="00">Real inteiro</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Começa em (horário de Brasília)</span>
        <input type="datetime-local" name="inicio" required className={fieldClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Termina em (horário de Brasília)</span>
        <input type="datetime-local" name="fim" required className={fieldClass} />
      </label>
      <p className="text-sm text-muted sm:col-span-2">
        O desconto vira o <strong>preço promocional</strong> de cada variação dos {total} {total === 1 ? "produto" : "produtos"}. Ao terminar, o preço promocional volta ao que era
        antes (ou fica vazio). Se alguém mudar o preço na loja durante a promoção, esse produto é preservado e avisado, sem sobrescrever a sua edição.
      </p>
      {state?.message && (
        <p role="alert" className="text-sm text-danger sm:col-span-2">
          {state.message}
        </p>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Agendando…" : "Agendar promoção"}
        </Button>
      </div>
    </form>
  );
}
