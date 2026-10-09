import Link from "next/link";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/admin";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { hojeEmBrasilia } from "@/lib/coupons/lote";
import { query } from "@/lib/db";
import { DIAS_PERIODO, coberturaDosPedidos, maisVendidos, periodos, porCategoria, porCorETamanho, resumoDoPeriodo, vendasPorDia } from "@/lib/orders/stats";
import { ultimaSincronizacaoPedidos } from "@/lib/orders/sync";
import { getActiveStore } from "@/lib/stores";
import { GraficoDias } from "./grafico-dias";
import { Ranking } from "./ranking";
import { SincronizarPedidos } from "./sincronizar-pedidos";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  dias: z.coerce.number().int().refine((n) => (DIAS_PERIODO as readonly number[]).includes(n)).catch(30),
  ordem: z.enum(["unidades", "valor"]).catch("unidades"),
});

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBr = (iso: string) => iso.split("-").reverse().join("/");

function Variacao({ atual, anterior }: { atual: number; anterior: number }) {
  if (anterior <= 0) return <span className="text-xs text-muted">sem base para comparar</span>;
  const pct = ((atual - anterior) / anterior) * 100;
  const sinal = pct > 0 ? "▲" : pct < 0 ? "▼" : "=";
  return (
    <span className="text-xs text-muted">
      {sinal} {Math.abs(pct).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}% vs. período anterior
    </span>
  );
}

function Kpi({ titulo, valor, atual, anterior }: { titulo: string; valor: string; atual: number; anterior: number }) {
  return (
    <Card className="flex flex-col gap-1">
      <p className="text-sm text-muted">{titulo}</p>
      <p className="text-2xl font-semibold">{valor}</p>
      <Variacao atual={atual} anterior={anterior} />
    </Card>
  );
}

export default async function VendasPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const store = await getActiveStore();
  if (!store) {
    return (
      <Card>
        <p className="text-sm text-muted">Conecte a loja na página inicial para ver as vendas.</p>
      </Card>
    );
  }
  const sp = paramsSchema.parse(await searchParams);
  const db = { query };
  const ultima = await ultimaSincronizacaoPedidos(db, store.id);
  const cobertura = await coberturaDosPedidos(db, store.id);
  const { atual, anterior } = periodos(hojeEmBrasilia(), sp.dias);

  const temDados = cobertura.total > 0;
  const [resumo, resumoAnterior, dias, produtos, categorias, variacoes] = temDados
    ? await Promise.all([
        resumoDoPeriodo(db, store.id, atual),
        resumoDoPeriodo(db, store.id, anterior),
        vendasPorDia(db, store.id, atual),
        maisVendidos(db, store.id, atual, sp.ordem, 15),
        porCategoria(db, store.id, atual),
        porCorETamanho(db, store.id, atual),
      ])
    : [null, null, [], [], [], { cores: [], tamanhos: [], semDado: 0 }];

  const href = (dias: number, ordem = sp.ordem) => `/vendas?dias=${dias}&ordem=${ordem}`;
  const pill = (ativo: boolean) => `rounded-full border px-3 py-1 ${ativo ? "border-primary bg-primary text-primary-foreground" : "border-border-strong hover:bg-border/40"}`;

  return (
    <main className="flex max-w-5xl flex-col gap-4 pb-20">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Vendas</h1>
          <p className="text-sm text-muted">Pedidos pagos e não cancelados, lidos da loja. Os dias seguem o horário de Brasília.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/promocoes/liquidar" className={buttonClass("outline")}>
            Produtos parados
          </Link>
          {temDados && (
            <a href={`/api/vendas/exportar?dias=${sp.dias}`} className={buttonClass("outline")} download>
              Exportar Excel
            </a>
          )}
        </div>
      </div>

      <Card className="flex flex-col gap-2">
        <SincronizarPedidos ultima={ultima} />
        {cobertura.primeiro && (
          <p className="text-xs text-muted">
            {cobertura.total} pedido(s) no painel, de {dataBr(cobertura.primeiro)} a {dataBr(cobertura.ultimo!)}. A primeira leitura traz os últimos 365 dias; depois só os pedidos alterados.
          </p>
        )}
      </Card>

      {!temDados || !resumo || !resumoAnterior ? (
        <Card>
          <p className="text-sm text-muted">Leia os pedidos da loja para ver faturamento, mais vendidos, categorias, cores e tamanhos. É só leitura: nada é alterado na loja.</p>
        </Card>
      ) : (
        <>
          <nav aria-label="Período" className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">Período:</span>
            {DIAS_PERIODO.map((d) => (
              <Link key={d} href={href(d)} aria-current={sp.dias === d ? "page" : undefined} className={pill(sp.dias === d)}>
                {d === 365 ? "12 meses" : `${d} dias`}
              </Link>
            ))}
            <span className="text-xs text-muted">
              {dataBr(atual.de)} a {dataBr(atual.ate)}
            </span>
          </nav>
          {cobertura.primeiro && cobertura.primeiro > atual.de && (
            <p className="text-sm text-muted">Atenção: os pedidos lidos começam em {dataBr(cobertura.primeiro)}; antes disso os números aparecem como zero.</p>
          )}

          <section aria-label="Resumo" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi titulo="Faturamento" valor={brl(resumo.faturamento)} atual={resumo.faturamento} anterior={resumoAnterior.faturamento} />
            <Kpi titulo="Pedidos" valor={resumo.pedidos.toLocaleString("pt-BR")} atual={resumo.pedidos} anterior={resumoAnterior.pedidos} />
            <Kpi titulo="Ticket médio" valor={brl(resumo.ticket)} atual={resumo.ticket} anterior={resumoAnterior.ticket} />
            <Kpi titulo="Peças vendidas" valor={resumo.unidades.toLocaleString("pt-BR")} atual={resumo.unidades} anterior={resumoAnterior.unidades} />
          </section>

          <Card className="flex flex-col gap-2">
            <h2 className="font-medium">Faturamento por dia</h2>
            <GraficoDias dias={dias} />
          </Card>

          <Card className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-medium">Mais vendidos</h2>
              <nav aria-label="Ordenar" className="flex gap-2 text-sm">
                <Link href={href(sp.dias, "unidades")} aria-current={sp.ordem === "unidades" ? "page" : undefined} className={pill(sp.ordem === "unidades")}>
                  Por peças
                </Link>
                <Link href={href(sp.dias, "valor")} aria-current={sp.ordem === "valor" ? "page" : undefined} className={pill(sp.ordem === "valor")}>
                  Por valor
                </Link>
              </nav>
            </div>
            {produtos.length === 0 ? (
              <p className="text-sm text-muted">Nenhuma venda neste período.</p>
            ) : (
              <Ranking
                linhas={produtos.map((p) => ({
                  chave: p.product_id,
                  nome: p.nome,
                  href: `/produtos/${p.product_id}`,
                  foto: p.foto,
                  valor: sp.ordem === "valor" ? p.valor : p.unidades,
                  texto: `${p.unidades} ${p.unidades === 1 ? "peça" : "peças"} · ${brl(p.valor)}`,
                  detalhe: p.estoque === null ? null : p.estoque === 0 ? "Sem estoque" : `${p.estoque} em estoque`,
                }))}
              />
            )}
            <p className="text-xs text-muted">Valor = preço × quantidade das linhas dos pedidos, antes de descontos do pedido e sem frete.</p>
          </Card>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card className="flex flex-col gap-3">
              <h2 className="font-medium">Por categoria</h2>
              <Ranking linhas={categorias.map((c) => ({ chave: c.nome, nome: c.nome, valor: c.valor, texto: `${brl(c.valor)} · ${c.unidades} ${c.unidades === 1 ? "peça" : "peças"}` }))} vazio="Sem vendas no período." />
              <p className="text-xs text-muted">Um produto em duas categorias conta nas duas.</p>
            </Card>
            <Card className="flex flex-col gap-3">
              <h2 className="font-medium">Por cor</h2>
              <Ranking linhas={variacoes.cores.map((c) => ({ chave: c.nome, nome: c.nome, valor: c.valor, texto: `${brl(c.valor)} · ${c.unidades} ${c.unidades === 1 ? "peça" : "peças"}` }))} vazio="Sem dados de cor nos pedidos." />
            </Card>
            <Card className="flex flex-col gap-3">
              <h2 className="font-medium">Por tamanho</h2>
              <Ranking linhas={variacoes.tamanhos.map((c) => ({ chave: c.nome, nome: c.nome, valor: c.valor, texto: `${brl(c.valor)} · ${c.unidades} ${c.unidades === 1 ? "peça" : "peças"}` }))} vazio="Sem dados de tamanho nos pedidos." />
            </Card>
          </div>
          {variacoes.semDado > 0 && <p className="text-xs text-muted">{variacoes.semDado} peça(s) vendidas sem cor/tamanho identificável (variação removida ou pedido sem esses dados).</p>}
        </>
      )}
    </main>
  );
}
