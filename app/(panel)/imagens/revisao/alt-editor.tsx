"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { ALT_MAX } from "@/lib/images/alt";
import { salvarAltAction, type AltState } from "./actions";

/** Texto alternativo da foto: edita e envia à loja. */
export function AltEditor({ productId, imageId, texto, naLoja }: { productId: number; imageId: string; texto: string; naLoja: string }) {
  const [state, action, pending] = useActionState<AltState | null, FormData>(salvarAltAction.bind(null, productId, imageId), null);
  return (
    <form action={action} className="flex flex-col gap-1">
      <label className="text-xs text-muted" htmlFor={`alt-${imageId}`}>
        Texto alternativo {naLoja ? "(na loja hoje: “" + naLoja + "”)" : "(a loja está sem texto)"}
      </label>
      <div className="flex flex-wrap gap-2">
        <input id={`alt-${imageId}`} name="alt" defaultValue={texto} maxLength={250} className="min-h-10 min-w-0 flex-1 rounded-md border border-border-strong bg-card px-3 text-sm" aria-describedby={`alt-dica-${imageId}`} />
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
    </form>
  );
}
