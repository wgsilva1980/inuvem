"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { veredito, type ProbeResult } from "@/lib/images/format-test";
import { runImageFormatTest, type FormatTestState } from "./actions";

const kb = (n: number | null) => (n === null ? "—" : `${Math.round(n / 1024)} KB`);
const dims = (p: ProbeResult) => (p.width && p.height ? `${p.width}×${p.height}` : "—");
const tipo = (p: ProbeResult) => p.contentType?.replace("image/", "") ?? "—";

export function FormatTestRunner() {
  const [state, action, pending] = useActionState<FormatTestState | null, FormData>(runImageFormatTest, null);
  const result = state?.result;
  return (
    <div className="flex flex-col gap-4">
      <form
        action={action}
        onSubmit={(e) => {
          if (!window.confirm("Rodar o teste agora? Ele cria um produto de teste NÃO publicado na Nuvemshop, envia duas imagens e apaga o produto no fim.")) e.preventDefault();
        }}
      >
        <Button type="submit" disabled={pending}>
          {pending ? "Testando… (pode levar 1 minuto)" : "Rodar o teste"}
        </Button>
      </form>

      {state?.message && <Alert tone="danger">{state.message}</Alert>}
      {result?.erro && <Alert tone="danger">O teste parou: {result.erro}</Alert>}
      {result && (
        <Alert tone={result.produtoApagado ? "success" : "danger"}>
          {result.produtoApagado ? "O produto de teste foi apagado da loja." : `ATENÇÃO: não consegui apagar o produto de teste${result.productId ? ` (id ${result.productId})` : ""}. Apague-o em Produtos (“ZZ teste de imagem”).`}
        </Alert>
      )}

      {result?.relatorios.map((r) => {
        const v = veredito(r);
        return (
          <Card key={r.formato} className="flex flex-col gap-3">
            <h2 className="text-base font-semibold">{r.formato === "webp" ? "WebP" : "JPEG"} · enviado com {kb(r.enviadoBytes)}</h2>
            <p className={`text-sm font-medium ${v.bom ? "text-success" : "text-danger"}`}>{v.texto}</p>
            {r.original && (
              <p className="text-sm text-muted">
                Original na loja: {tipo(r.original)} · {dims(r.original)} · {kb(r.original.bytes)}
              </p>
            )}
            {r.tamanhos.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-muted">
                    <tr>
                      <th className="py-1 pr-3 font-medium">Versão</th>
                      <th className="py-1 pr-3 font-medium">Resultado</th>
                      <th className="py-1 pr-3 font-medium">Formato</th>
                      <th className="py-1 pr-3 font-medium">Dimensões</th>
                      <th className="py-1 font-medium">Peso</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.tamanhos.map((t) => (
                      <tr key={t.tamanho} className="border-t border-border">
                        <td className="py-1 pr-3">{t.tamanho} px</td>
                        <td className={`py-1 pr-3 ${t.resultado.ok ? "text-success" : "text-danger"}`}>{t.resultado.ok ? "existe" : `não existe${t.resultado.status ? ` (${t.resultado.status})` : ""}`}</td>
                        <td className="py-1 pr-3">{tipo(t.resultado)}</td>
                        <td className="py-1 pr-3">{dims(t.resultado)}</td>
                        <td className="py-1">{kb(t.resultado.bytes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
