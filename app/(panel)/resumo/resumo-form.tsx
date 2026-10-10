"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fieldBase } from "@/components/ui/field";
import { salvarResumoAction, type ResumoState } from "./actions";

export function ResumoForm({ enabled, recipients, onlyIfAction, admins, emailPronto }: { enabled: boolean; recipients: string[]; onlyIfAction: boolean; admins: string[]; emailPronto: boolean }) {
  const [state, action, pending] = useActionState<ResumoState | null, FormData>(salvarResumoAction, null);
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  async function enviarTeste() {
    setEnviando(true);
    setMsg(null);
    const res = await fetch("/api/resumo/enviar", { method: "POST" });
    const d = (await res.json().catch(() => ({}))) as { error?: string; destinatarios?: number };
    setEnviando(false);
    setMsg(res.ok ? { ok: true, texto: `Teste enviado para ${d.destinatarios} destinatário(s). Confira a caixa de entrada e o spam.` } : { ok: false, texto: d.error ?? "Não foi possível enviar." });
  }

  return (
    <div className="flex flex-col gap-3">
      <form action={action}>
        <Card className="flex flex-col gap-3">
          <label className="flex items-center gap-2 font-medium">
            <input type="checkbox" name="enabled" defaultChecked={enabled} />
            Enviar o resumo todo dia de manhã (cerca de 7h, horário de Brasília)
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Destinatários (e-mails de administradores do painel, separados por vírgula ou espaço; até 5)</span>
            <textarea name="destinatarios" rows={2} defaultValue={recipients.join(", ")} placeholder={admins.slice(0, 2).join(", ")} className={fieldBase} />
          </label>
          {admins.length > 0 && <p className="text-xs text-muted">Administradores: {admins.join(", ")}.</p>}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="somenteComAcao" defaultChecked={onlyIfAction} />
            Só enviar quando houver algo urgente ou de atenção
          </label>
          {state?.message && (
            <p role={state.ok ? "status" : "alert"} className={`text-sm ${state.ok ? "text-success" : "text-danger"}`}>
              {state.message}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando…" : "Salvar"}
            </Button>
            <Button type="button" variant="outline" disabled={enviando || !emailPronto} onClick={enviarTeste}>
              {enviando ? "Enviando…" : "Enviar um teste agora"}
            </Button>
          </div>
          {!emailPronto && <p className="text-xs text-danger">O envio de e-mail ainda não está configurado (falta RESEND_API_KEY na Vercel). Veja as instruções abaixo.</p>}
          {msg && (
            <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-success" : "text-danger"}`}>
              {msg.texto}
            </p>
          )}
        </Card>
      </form>
    </div>
  );
}
