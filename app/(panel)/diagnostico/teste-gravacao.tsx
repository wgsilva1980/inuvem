"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { relatorioGravacaoTexto, type ResultadoGravacao, type StatusPasso } from "@/lib/diagnostico/gravacao";

const TOM: Record<StatusPasso, "success" | "danger" | "neutral"> = { ok: "success", falha: "danger", pulado: "neutral" };
const ROTULO: Record<StatusPasso, string> = { ok: "OK", falha: "Falhou", pulado: "Pulado" };

export function TesteGravacao() {
  const [rodando, setRodando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [r, setR] = useState<ResultadoGravacao | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);

  async function rodar() {
    if (!confirm("Rodar o teste de gravação? O painel vai criar na sua loja um produto de teste OCULTO e um cupom DESATIVADO, mexer neles e apagar tudo em seguida. Nenhum produto ou cupom seu é alterado.")) return;
    setRodando(true);
    setErro(null);
    setCopiado(null);
    try {
      const res = await fetch("/api/diagnostico/gravacao", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmo: true }) });
      const data = (await res.json().catch(() => ({}))) as ResultadoGravacao & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Não foi possível rodar o teste.");
      setR(data);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao rodar o teste.");
    } finally {
      setRodando(false);
    }
  }

  async function copiar() {
    if (!r) return;
    try {
      await navigator.clipboard.writeText(relatorioGravacaoTexto(r));
      setCopiado("Relatório copiado. Pode colar na conversa.");
    } catch {
      setCopiado("Não consegui copiar; selecione o texto e copie à mão.");
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="font-medium">Teste de gravação</h2>
      <p className="text-sm text-muted">
        O teste acima só lê. Este confere se o painel consegue <strong>escrever</strong> na loja: cria um produto de teste <strong>oculto</strong> e um cupom <strong>desativado</strong>, muda estoque, preço, nome e SEO, confere a leitura de volta e <strong>apaga tudo</strong>. Só mexe no que ele mesmo cria. Leva uns 20 segundos.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={rodar} disabled={rodando} className="min-h-11">
          {rodando ? "Testando a gravação… (até 40 s)" : r ? "Rodar o teste de gravação de novo" : "Rodar o teste de gravação"}
        </Button>
        {r && (
          <Button type="button" variant="outline" onClick={copiar} className="min-h-11">
            Copiar relatório
          </Button>
        )}
      </div>
      {copiado && (
        <p role="status" className="text-xs text-muted">
          {copiado}
        </p>
      )}
      {erro && (
        <p role="alert" className="text-sm text-danger">
          {erro}
        </p>
      )}
      {r && (
        <>
          <p role="status" className={`text-sm font-medium ${r.tudoCerto ? "text-success" : "text-danger"}`}>
            {r.tudoCerto ? "Tudo certo: o painel consegue gravar na sua loja e a limpeza foi completa." : "O teste encontrou problemas (veja abaixo)."}
          </p>
          {r.sobras.length > 0 && (
            <div role="alert" className="rounded-md border border-danger/50 p-3 text-sm">
              <p className="font-medium text-danger">Ficou algo para trás na sua loja. Apague à mão:</p>
              <ul className="list-disc pl-5">
                {r.sobras.map((s) => (
                  <li key={`${s.tipo}-${s.id}`}>
                    {s.tipo === "produto" ? "Produto" : "Cupom"} “{s.nome}” — {s.situacao}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ul className="flex flex-col gap-2 text-sm">
            {r.passos.map((p) => (
              <li key={p.id} className="flex flex-col gap-0.5 border-t border-border pt-2">
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={TOM[p.status]}>{ROTULO[p.status]}</Badge>
                  <span className="font-medium">{p.titulo}</span>
                </span>
                <span className="text-muted">{p.mensagem}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
