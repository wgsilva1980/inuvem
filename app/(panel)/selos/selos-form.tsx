"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fieldBase } from "@/components/ui/field";
import type { BadgeSettings } from "@/lib/badges/settings";
import { salvarSelosAction, type SelosState } from "./actions";

export function SelosForm({ config }: { config: BadgeSettings }) {
  const [state, action, pending] = useActionState<SelosState | null, FormData>(salvarSelosAction, null);
  const [zap, setZap] = useState(config.whatsappEnabled);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3">
        <label className="flex items-center gap-2 font-medium">
          <input type="checkbox" name="enabled" defaultChecked={config.enabled} />
          Selos ligados na vitrine
        </label>
        <p className="text-sm text-muted">Interruptor geral. Desligado, a vitrine não mostra nada, mesmo com o código já colado na loja.</p>
      </Card>

      <Card className="flex flex-col gap-3">
        <label className="flex items-center gap-2 font-medium">
          <input type="checkbox" name="lowStockEnabled" defaultChecked={config.lowStockEnabled} />
          “Últimas unidades!”
        </label>
        <label className="flex items-center gap-2 text-sm">
          Mostrar quando o estoque somado do produto for de 1 até
          <input name="lowStockMax" type="number" min={1} max={20} defaultValue={config.lowStockMax} className={`${fieldBase} w-20`} />
          unidades
        </label>
        <p className="text-xs text-muted">Só vale para produtos com estoque controlado em todas as variações. O selo não mostra o número, porque o estoque do painel pode estar alguns minutos atrasado.</p>
      </Card>

      <Card className="flex flex-col gap-2">
        <label className="flex items-center gap-2 font-medium">
          <input type="checkbox" name="countdownEnabled" defaultChecked={config.countdownEnabled} />
          Contagem regressiva da promoção
        </label>
        <p className="text-sm text-muted">Aparece nos produtos de uma promoção agendada que está no ar (menu Promoções) e conta até a hora de encerrar.</p>
      </Card>

      <Card className="flex flex-col gap-3">
        <label className="flex items-center gap-2 font-medium">
          <input type="checkbox" name="whatsappEnabled" checked={zap} onChange={(e) => setZap(e.target.checked)} />
          Botão “Falar no WhatsApp sobre esta peça”
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">WhatsApp da loja (com DDD)</span>
            <input name="whatsappNumber" defaultValue={config.whatsappNumber} placeholder="(11) 91234-5678" className={fieldBase} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Mensagem (use {"{produto}"} para o nome da peça)</span>
            <input name="whatsappMessage" defaultValue={config.whatsappMessage} maxLength={200} className={fieldBase} />
          </label>
        </div>
        <p className="text-xs text-muted">O link da página do produto é acrescentado ao fim da mensagem. Nada é enviado: a cliente abre o WhatsApp com o texto pronto.</p>
      </Card>

      {state?.message && (
        <p role={state.ok ? "status" : "alert"} className={`rounded-md border border-border bg-card p-3 text-sm ${state.ok ? "text-success" : "text-danger"}`}>
          {state.message}
        </p>
      )}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Salvando…" : "Salvar"}
        </Button>
      </div>
    </form>
  );
}
