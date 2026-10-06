"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ALT_MAX } from "@/lib/images/alt";
import { diagnosticarAltAction, salvarAltAction, type AltState, type DiagnosticoState } from "./actions";

/** Texto alternativo da foto: edita e envia à loja. */
export function AltEditor({ productId, imageId, texto, naLoja }: { productId: number; imageId: string; texto: string; naLoja: string }) {
  const [state, action, pending] = useActionState<AltState | null, FormData>(salvarAltAction.bind(null, productId, imageId), null);
  const [texto_, setTexto] = useState(texto);
  const [diag, setDiag] = useState<DiagnosticoState | null>(null);
  const [diagPending, iniciarDiag] = useTransition();
  return (
    <form action={action} className="flex flex-col gap-1">
      <label className="text-xs text-muted" htmlFor={`alt-${imageId}`}>
        Texto alternativo {naLoja ? "(na loja hoje: “" + naLoja + "”)" : "(a loja está sem texto)"}
      </label>
      <div className="flex flex-wrap gap-2">
        <input id={`alt-${imageId}`} name="alt" value={texto_} onChange={(e) => setTexto(e.target.value)} maxLength={250} className="min-h-10 min-w-0 flex-1 rounded-md border border-border-strong bg-card px-3 text-sm" aria-describedby={`alt-dica-${imageId}`} />
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Salvando…" : "Salvar na loja"}
        </Button>
      </div>
      <p id={`alt-dica-${imageId}`} className="text-xs text-muted">
        Ideal: até {ALT_MAX} caracteres.
      </p>
      {state?.message && (
        <p role={state.ok ? "status" : "alert"} className={`text-sm ${state.ok ? "text-success" : "text-danger"}`}>
          {state.message}
        </p>
      )}
      {state && !state.ok && (
        <div className="flex flex-col gap-1">
          <div>
            <Button type="button" variant="outline" disabled={diagPending} onClick={() => iniciarDiag(async () => setDiag(await diagnosticarAltAction(productId, imageId, texto_)))}>
              {diagPending ? "Diagnosticando… (uns 8 s)" : "Diagnosticar o envio"}
            </Button>
          </div>
          {diag?.message && <p className="text-sm text-danger">{diag.message}</p>}
          {diag?.passos && (
            <pre className="overflow-x-auto whitespace-pre-wrap rounded border border-border bg-card p-2 text-xs">{diag.passos.map((p) => `${p.passo}\n   ${p.resultado}`).join("\n")}</pre>
          )}
        </div>
      )}
    </form>
  );
}
