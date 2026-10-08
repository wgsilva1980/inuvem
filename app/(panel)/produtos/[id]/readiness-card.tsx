"use client";

import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { Checklist, StatusItem } from "@/lib/catalog/readiness";
import { publicarProduto, type SaveState } from "./actions";

const ICONE: Record<StatusItem, { simbolo: string; classe: string; texto: string }> = {
  ok: { simbolo: "✓", classe: "text-success", texto: "Ok" },
  falta: { simbolo: "✕", classe: "text-danger", texto: "Falta" },
  atencao: { simbolo: "!", classe: "text-warning", texto: "Atenção" },
  info: { simbolo: "–", classe: "text-muted", texto: "Não conferido" },
};

/**
 * Checklist de publicação: mostra o que falta para o produto ir à vitrine (obrigatórios e recomendados) e publica com um clique.
 * Faltando algo obrigatório, pede confirmação antes de publicar.
 */
export function ReadinessCard({ productId, publicado, checklist }: { productId: number; publicado: boolean; checklist: Checklist }) {
  const [pendente, comecar] = useTransition();
  const [resultado, setResultado] = useState<SaveState | null>(null);
  const { itens, pronto, obrigatoriosFaltando, recomendadosFaltando, ok, total } = checklist;
  const percentual = Math.round((ok / total) * 100);

  function publicar() {
    if (!pronto && !window.confirm(`Faltam ${obrigatoriosFaltando} ${obrigatoriosFaltando === 1 ? "item obrigatório" : "itens obrigatórios"} no checklist. Publicar mesmo assim?`)) return;
    comecar(async () => setResultado(await publicarProduto(productId)));
  }

  const pendentes = itens.filter((i) => i.status === "falta" || i.status === "atencao" || i.status === "info");
  const feitos = itens.filter((i) => i.status === "ok");

  return (
    <Card className="flex flex-col gap-3" aria-labelledby="checklist-titulo">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="checklist-titulo" className="text-base font-semibold">
          Checklist de publicação
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {publicado ? <Badge tone="success">Publicado na loja</Badge> : <Badge tone="neutral">Rascunho (não aparece na vitrine)</Badge>}
          {pronto ? <Badge tone="success">Pronto para publicar</Badge> : <Badge tone="danger">{obrigatoriosFaltando} {obrigatoriosFaltando === 1 ? "item obrigatório falta" : "itens obrigatórios faltam"}</Badge>}
        </div>
      </div>

      <div>
        <div className="h-2 overflow-hidden rounded-full bg-border" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={ok} aria-label="Itens do checklist atendidos">
          <div className={`h-full ${pronto ? "bg-success" : "bg-warning"}`} style={{ width: `${percentual}%` }} />
        </div>
        <p className="mt-1 text-xs text-muted">
          {ok} de {total} itens ok{recomendadosFaltando > 0 ? ` · ${recomendadosFaltando} ${recomendadosFaltando === 1 ? "recomendação" : "recomendações"} para melhorar` : ""}
        </p>
      </div>

      {pendentes.length > 0 && (
        <ul className="flex flex-col gap-2 text-sm">
          {pendentes.map((i) => (
            <li key={i.chave} className="flex gap-2">
              <span className={`w-4 shrink-0 text-center font-bold ${ICONE[i.status].classe}`} aria-label={ICONE[i.status].texto}>
                {ICONE[i.status].simbolo}
              </span>
              <span className="min-w-0">
                <span className="font-medium">{i.rotulo}</span>
                {i.obrigatorio ? <span className="ml-1 text-xs text-danger">(obrigatório)</span> : null}
                <span className="block text-muted">
                  {i.detalhe}
                  {i.ancora ? (
                    <>
                      {" "}
                      <a href={`#${i.ancora}`} className="underline">
                        Ir para a seção
                      </a>
                    </>
                  ) : null}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {feitos.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">Itens que já estão ok ({feitos.length})</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {feitos.map((i) => (
              <li key={i.chave} className="flex gap-2">
                <span className="w-4 shrink-0 text-center font-bold text-success" aria-label="Ok">
                  ✓
                </span>
                <span>
                  {i.rotulo} <span className="text-muted">· {i.detalhe}</span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {!publicado && (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <div>
            <Button type="button" disabled={pendente} onClick={publicar}>
              {pendente ? "Publicando…" : pronto ? "Publicar na loja" : "Publicar mesmo assim…"}
            </Button>
          </div>
          <p className="text-xs text-muted">Publica só este produto; nada mais é alterado. Dá para desmarcar “Publicado na loja” no formulário quando quiser.</p>
        </div>
      )}

      {resultado?.message && (
        <Alert tone={resultado.ok ? "success" : "danger"} role="status">
          {resultado.message}
        </Alert>
      )}
    </Card>
  );
}
