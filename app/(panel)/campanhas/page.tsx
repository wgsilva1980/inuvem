import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ROTULO_FASE, proximasCampanhas, type CampanhaPrevista, type Fase } from "@/lib/campaigns/calendario";
import { historicoDaCampanha } from "@/lib/campaigns/historico";
import { hojeEmBrasilia } from "@/lib/coupons/lote";
import { brl } from "@/lib/costs/math";
import { query } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";

const LIMITE = 8;
const COM_HISTORICO = 4;
const TOM: Record<Fase, "neutral" | "warning" | "success" | "danger"> = { futura: "neutral", comprar: "warning", preparar: "warning", vendendo: "success" };
const dia = (iso: string) => iso.split("-").reverse().join("/");
const semana = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("pt-BR", { weekday: "long", timeZone: "UTC" });
const contagem = (n: number) => (n === 0 ? "hoje" : n === 1 ? "amanhã" : `em ${n} dias`);

function proximoPasso(c: CampanhaPrevista): string {
  if (c.fase === "futura") return `Vá planejando: o ideal é encomendar a mercadoria até ${dia(c.prazoCompra)}.`;
  if (c.fase === "comprar") return `Já é hora de encomendar a mercadoria (o ideal era até ${dia(c.prazoCompra)}). Comece a montar a promoção em ${dia(c.inicioPromo)}.`;
  if (c.fase === "preparar") return `O prazo ideal de compra (${dia(c.prazoCompra)}) já passou: confira o estoque e prepare a promoção, as fotos e os avisos. As vendas começam em ${dia(c.inicioVendas)}.`;
  return c.dias === 0 ? "É hoje." : `Período de vendas em andamento, até ${dia(c.data)}.`;
}

export default async function CampanhasPage() {
  await requireAdmin();
  const store = await getActiveStore();
  if (!store) {
    return (
      <Card>
        <p className="text-sm text-muted">Conecte a loja na página inicial para ver o calendário de campanhas.</p>
      </Card>
    );
  }
  const db = { query };
  const hoje = hojeEmBrasilia();
  const campanhas = proximasCampanhas(hoje).slice(0, LIMITE);
  const historicos = await Promise.all(campanhas.map((c, i) => (i < COM_HISTORICO ? historicoDaCampanha(db, store.id, c).catch(() => null) : Promise.resolve(null))));

  return (
    <main className="flex max-w-4xl flex-col gap-4 pb-24">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Calendário de campanhas</h1>
        <p className="text-sm text-muted">
          As datas que mais vendem em moda feminina, com a contagem regressiva e o que fazer em cada fase: comprar estoque, montar a promoção e vender. Os prazos são pontos de partida de mercado; ajuste ao prazo real do seu fornecedor. Os números do ano passado vêm dos pedidos que o painel já leu.
        </p>
      </div>

      <ul className="flex flex-col gap-3">
        {campanhas.map((c, i) => {
          const h = historicos[i];
          return (
            <li key={`${c.id}-${c.data}`}>
              <Card className="flex flex-col gap-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold">
                      {c.nome} <span className="font-normal text-muted">· {dia(c.data)} ({semana(c.data)})</span>
                    </h2>
                    <p className="text-sm text-muted">
                      {contagem(c.dias)}
                      {c.relevancia === "alta" ? " · data de alta venda" : ""}
                    </p>
                  </div>
                  <Badge tone={TOM[c.fase]}>{ROTULO_FASE[c.fase]}</Badge>
                </div>

                <p className="text-sm">{proximoPasso(c)}</p>

                <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-muted">Encomendar até</dt>
                    <dd>{dia(c.prazoCompra)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Montar a promoção desde</dt>
                    <dd>{dia(c.inicioPromo)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Vendas da campanha</dt>
                    <dd>
                      {dia(c.inicioVendas)} a {dia(c.data)}
                    </dd>
                  </div>
                </dl>

                {h && (
                  <div className="rounded-md border border-border p-3 text-sm">
                    <p className="font-medium">
                      No ano passado ({dia(h.janela.de)} a {dia(h.janela.ate)})
                    </p>
                    {!h.coberto ? (
                      <p className="text-muted">O painel não leu os pedidos daquela época, então não há comparação. Leia os pedidos em Vendas para o painel guardar o histórico daqui para a frente.</p>
                    ) : h.vendas.pedidos === 0 ? (
                      <p className="text-muted">Nenhuma venda paga nesse período.</p>
                    ) : (
                      <>
                        <p>
                          {brl(h.vendas.faturamento)} em {h.vendas.pedidos} {h.vendas.pedidos === 1 ? "pedido" : "pedidos"} ({h.vendas.unidades} {h.vendas.unidades === 1 ? "peça" : "peças"}).
                          {h.fator !== null && (
                            <>
                              {" "}
                              Foi <strong>{h.fator.toLocaleString("pt-BR")}×</strong> o ritmo normal dos 60 dias antes.
                            </>
                          )}
                        </p>
                        {h.fator !== null && h.fator > 1.2 && <p className="text-muted">A sugestão de compras parte do ritmo de hoje: considere comprar mais do que ela mostra para os campeões de venda.</p>}
                        {h.maisVendidos.length > 0 && <p className="text-muted">Mais vendidos: {h.maisVendidos.map((p) => `${p.nome} (${p.unidades})`).join(", ")}.</p>}
                      </>
                    )}
                  </div>
                )}

                <p className="text-sm text-muted">{c.dica}</p>

                <div className="flex flex-wrap gap-2">
                  <Link href={`/compras?prazo=${c.prazoCompras}&cobertura=30`} className={buttonClass("outline", "min-h-11")}>
                    Planejar a compra
                  </Link>
                  <Link href="/promocoes" className={buttonClass("outline", "min-h-11")}>
                    Montar a promoção
                  </Link>
                  <Link href="/simulador" className={buttonClass("outline", "min-h-11")}>
                    Simular o desconto
                  </Link>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
