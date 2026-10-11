"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fieldBase } from "@/components/ui/field";
import { salvarAlertasAction, type AlertasState } from "./actions";

interface Cfg {
  enabled: boolean;
  recipients: string[];
  onPaidOrder: boolean;
  onOutOfStock: boolean;
  onSyncFailure: boolean;
}

export function AlertasForm({ cfg, admins, emailPronto }: { cfg: Cfg; admins: string[]; emailPronto: boolean }) {
  const [state, action, pending] = useActionState<AlertasState | null, FormData>(salvarAlertasAction, null);
  const [ocupado, setOcupado] = useState<"teste" | "webhook" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  async function enviarTeste() {
    setOcupado("teste");
    setMsg(null);
    const res = await fetch("/api/alertas/teste", { method: "POST" });
    const d = (await res.json().catch(() => ({}))) as { error?: string; enviados?: number; aviso?: string };
    setOcupado(null);
    setMsg(res.ok ? { ok: !d.aviso, texto: `Teste enviado para ${d.enviados} destinatário(s). Confira a caixa de entrada e o spam.${d.aviso ? ` ${d.aviso}` : ""}` } : { ok: false, texto: d.error ?? "Não foi possível enviar." });
  }

  async function ativarPedidoPago() {
    setOcupado("webhook");
    setMsg(null);
    const res = await fetch("/api/alertas/webhooks", { method: "POST" });
    const d = (await res.json().catch(() => ({}))) as { error?: string; created?: string[]; existing?: string[]; otherUrl?: string[]; failed?: Array<{ message: string }> };
    setOcupado(null);
    if (!res.ok) return setMsg({ ok: false, texto: d.error ?? "Não foi possível ativar." });
    if (d.failed && d.failed.length > 0) return setMsg({ ok: false, texto: `A Nuvemshop recusou: ${d.failed[0]!.message}` });
    setMsg({ ok: true, texto: d.created && d.created.length > 0 ? "Aviso de pedido pago ativado na Nuvemshop." : "O aviso de pedido pago já estava ativo." });
  }

  return (
    <form action={action}>
      <Card className="flex flex-col gap-3">
        <label className="flex items-center gap-2 font-medium">
          <input type="checkbox" name="enabled" defaultChecked={cfg.enabled} />
          Enviar alertas por e-mail
        </label>
        <fieldset className="flex flex-col gap-1 pl-6 text-sm">
          <legend className="sr-only">Quais alertas</legend>
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" name="pedidoPago" defaultChecked={cfg.onPaidOrder} className="size-4" />
            Pedido pago
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" name="esgotado" defaultChecked={cfg.onOutOfStock} className="size-4" />
            Produto esgotado
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" name="syncFalhou" defaultChecked={cfg.onSyncFailure} className="size-4" />
            Sincronização falhou
          </label>
        </fieldset>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Destinatários (e-mails de administradores do painel, separados por vírgula ou espaço; até 5)</span>
          <textarea name="destinatarios" rows={2} defaultValue={cfg.recipients.join(", ")} placeholder={admins.slice(0, 2).join(", ")} className={fieldBase} />
        </label>
        {admins.length > 0 && <p className="text-xs text-muted">Administradores: {admins.join(", ")}.</p>}
        {state?.message && (
          <p role={state.ok ? "status" : "alert"} className={`text-sm ${state.ok ? "text-success" : "text-danger"}`}>
            {state.message}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? "Salvando…" : "Salvar"}
          </Button>
          <Button type="button" variant="outline" disabled={ocupado !== null || !emailPronto} onClick={enviarTeste}>
            {ocupado === "teste" ? "Enviando…" : "Enviar um teste agora"}
          </Button>
          <Button type="button" variant="outline" disabled={ocupado !== null} onClick={ativarPedidoPago}>
            {ocupado === "webhook" ? "Ativando…" : "Ativar aviso de pedido pago"}
          </Button>
        </div>
        {!emailPronto && <p className="text-xs text-danger">O envio de e-mail ainda não está configurado (falta RESEND_API_KEY na Vercel). Veja as instruções em Resumo diário.</p>}
        {msg && (
          <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-success" : "text-danger"}`}>
            {msg.texto}
          </p>
        )}
      </Card>
    </form>
  );
}
