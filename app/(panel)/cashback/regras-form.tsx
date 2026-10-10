"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fieldBase } from "@/components/ui/field";
import type { CashbackConfig } from "@/lib/cashback/rules";
import { salvarRegrasAction, type CashbackState } from "./actions";

const campo = "flex flex-col gap-1 text-sm";

export function RegrasForm({ config }: { config: CashbackConfig }) {
  const [state, action, pending] = useActionState<CashbackState | null, FormData>(salvarRegrasAction, null);
  return (
    <form action={action}>
      <Card className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <label className={campo}>
            <span className="text-muted">Cashback (% do pedido)</span>
            <input name="percent" inputMode="decimal" defaultValue={String(config.percent).replace(".", ",")} className={fieldBase} />
          </label>
          <label className={campo}>
            <span className="text-muted">Teto de cada cupom (R$)</span>
            <input name="maxValue" inputMode="decimal" defaultValue={String(config.maxValue).replace(".", ",")} className={fieldBase} />
          </label>
          <label className={campo}>
            <span className="text-muted">Pedido mínimo para ganhar (R$)</span>
            <input name="minOrder" inputMode="decimal" defaultValue={String(config.minOrder).replace(".", ",")} className={fieldBase} />
          </label>
          <label className={campo}>
            <span className="text-muted">Compra mínima para usar (R$)</span>
            <input name="minPurchase" inputMode="decimal" defaultValue={String(config.minPurchase).replace(".", ",")} className={fieldBase} />
          </label>
          <label className={campo}>
            <span className="text-muted">Validade do cupom (dias)</span>
            <input name="validDays" inputMode="numeric" defaultValue={config.validDays} className={fieldBase} />
          </label>
          <label className={campo}>
            <span className="text-muted">Esperar depois do pedido (dias)</span>
            <input name="waitDays" inputMode="numeric" defaultValue={config.waitDays} className={fieldBase} />
          </label>
          <label className={campo}>
            <span className="text-muted">Orçamento do mês (R$)</span>
            <input name="monthBudget" inputMode="decimal" defaultValue={String(config.monthBudget).replace(".", ",")} className={fieldBase} />
          </label>
        </div>
        <p className="text-xs text-muted">
          O valor do cupom é o percentual do pedido, para baixo em reais inteiros, até o teto. A espera dá tempo de trocas e devoluções antes do cupom. O orçamento é a soma máxima de cupons emitidos no mês: ao acabar, nenhum outro é criado. Mudar as regras não altera cupons já emitidos.
        </p>
        {state?.message && (
          <p role={state.ok ? "status" : "alert"} className={`text-sm ${state.ok ? "text-success" : "text-danger"}`}>
            {state.message}
          </p>
        )}
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Salvando…" : "Salvar regras"}
          </Button>
        </div>
      </Card>
    </form>
  );
}
