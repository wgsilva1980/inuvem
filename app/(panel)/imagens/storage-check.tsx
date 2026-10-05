"use client";

import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { TesteArmazenamento } from "@/lib/images/storage-test";
import { testarArmazenamentoAction } from "./actions";

/** Confere se o Vercel Blob (cópias das fotos originais) está ligado e funcionando. */
export function StorageCheck() {
  const [r, setR] = useState<TesteArmazenamento | null>(null);
  const [pending, start] = useTransition();
  const ok = r?.gravou && r.leu && r.apagou;
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button type="button" variant="outline" disabled={pending} onClick={() => start(async () => setR(await testarArmazenamentoAction()))}>
          {pending ? "Testando…" : "Testar armazenamento (Blob)"}
        </Button>
      </div>
      {r && (
        <Alert tone={ok ? "success" : "danger"}>
          {ok
            ? `Armazenamento funcionando: gravou, leu e apagou um arquivo de teste (modo ${r.acesso === "private" ? "privado" : "público"}).${r.acesso === "public" ? " Atenção: o armazenamento é público; para guardar as fotos originais o ideal é privado." : ""}`
            : (r.erro ?? "O teste não concluiu.")}
        </Alert>
      )}
    </div>
  );
}
