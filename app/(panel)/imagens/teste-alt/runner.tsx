"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { runAltTest, type AltTesteState } from "./actions";

export function AltTestRunner() {
  const [state, action, pending] = useActionState<AltTesteState | null, FormData>(runAltTest, null);
  const r = state?.result;
  return (
    <div className="flex flex-col gap-4">
      <form
        action={action}
        onSubmit={(e) => {
          if (!window.confirm("Rodar o teste agora? Ele cria um produto de teste NÃO publicado na Nuvemshop, tenta gravar o texto alternativo por várias rotas e apaga o produto no fim.")) e.preventDefault();
        }}
      >
        <Button type="submit" disabled={pending}>
          {pending ? "Testando… (uns 30 s)" : "Rodar o teste"}
        </Button>
      </form>
      {state?.message && <Alert tone="danger">{state.message}</Alert>}
      {r?.erro && <Alert tone="danger">O teste parou: {r.erro}</Alert>}
      {r && (
        <Alert tone={r.produtoApagado ? "success" : "danger"}>
          {r.produtoApagado ? "O produto de teste foi apagado da loja." : "ATENÇÃO: não consegui apagar o produto de teste. Apague-o em Produtos (“ZZ teste de alt”)."}
        </Alert>
      )}
      {r && (
        <Card className="flex flex-col gap-2">
          <p className={`text-sm font-medium ${r.formaQueGravou ? "text-success" : "text-danger"}`}>{r.formaQueGravou ? `A loja gravou o texto por: ${r.formaQueGravou}` : "Nenhuma das rotas gravou o texto alternativo."}</p>
          <pre className="overflow-x-auto whitespace-pre-wrap text-xs">{r.passos.map((p) => `${p.gravou ? "✔" : "✘"} ${p.tentativa}\n   ${p.resposta}\n   alt depois: ${p.altDepois ?? "(não consegui ler)"}`).join("\n")}</pre>
        </Card>
      )}
    </div>
  );
}
