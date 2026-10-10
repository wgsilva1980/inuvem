"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button, buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fieldBase } from "@/components/ui/field";
import { RichTextEditor } from "@/components/rich-text-editor";
import { excluirBlocoAction, salvarBlocoAction, type BlocoFormState } from "./actions";

export function BlocoForm({ bloco, inicial }: { bloco?: { id: string; name: string; html: string }; inicial?: { nome: string; html: string } }) {
  const [state, action, pending] = useActionState<BlocoFormState | null, FormData>(salvarBlocoAction, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      {bloco && <input type="hidden" name="id" value={bloco.id} />}
      <Card className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Nome do bloco</span>
          <input name="nome" required maxLength={80} defaultValue={bloco?.name ?? inicial?.nome ?? ""} placeholder="Ex.: Tabela de medidas" className={fieldBase} />
        </label>
        <div className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Conteúdo</span>
          <RichTextEditor name="html" defaultValue={bloco?.html ?? inicial?.html ?? ""} id="bloco-editor" />
          <p className="text-xs text-muted">Aceita títulos, listas, tabelas, links e imagens (por endereço). Trechos “[preencher: …]” precisam ser completados antes de aplicar o bloco nos produtos.</p>
        </div>
      </Card>
      {state?.message && (
        <p role="alert" className="rounded-md border border-border bg-card p-3 text-sm text-danger">
          {state.message}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Salvando…" : "Salvar bloco"}
        </Button>
        <Link href="/conteudo" className={buttonClass("outline")}>
          Cancelar
        </Link>
        {bloco && (
          <button
            type="button"
            className="ml-auto text-sm text-danger underline"
            onClick={async () => {
              if (confirm("Excluir este bloco? As descrições dos produtos que já o receberam não mudam.")) await excluirBlocoAction(bloco.id);
            }}
          >
            Excluir bloco
          </button>
        )}
      </div>
      {bloco && <p className="text-sm text-muted">Mudar o bloco aqui não altera as descrições já gravadas na loja. Para levar a nova versão aos produtos, aplique o bloco de novo em “Operação em massa” (ele atualiza no mesmo lugar, sem duplicar).</p>}
    </form>
  );
}
