import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fieldBase } from "@/components/ui/field";
import { brl } from "@/lib/costs/math";
import { buscarParaSimular, margemMinima, produtoParaSimular } from "@/lib/costs/repo";
import { SimuladorErro, numeroBR, simular, type Cenario } from "@/lib/costs/simulador";
import { query } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";

type Params = Record<string, string | undefined>;
const pct = (n: number | null) => (n === null ? "—" : `${n.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`);
const campo = (v: string | undefined) => (v ?? "").slice(0, 20);
const numero = (n: number) => String(n).replace(".", ",");

function Linha({ c, destaque }: { c: Cenario; destaque?: boolean }) {
  return (
    <tr className={`border-t border-border ${destaque ? "font-medium" : ""}`}>
      <td className="py-2 pr-3">{c.desconto === 0 ? "Preço cheio" : `${c.desconto}% de desconto`}</td>
      <td className="py-2 pr-3">{brl(c.preco)}</td>
      <td className={`py-2 pr-3 ${c.lucro < 0 ? "text-danger" : ""}`}>{brl(c.lucro)}</td>
      <td className="py-2 pr-3">{pct(c.margem)}</td>
      <td className="py-2">{c.desconto === 0 ? "—" : c.vendasParaIgualar === null ? <span className="text-muted">sem lucro</span> : `${c.vendasParaIgualar.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×`}</td>
    </tr>
  );
}

export default async function SimuladorPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireAdmin();
  const store = await getActiveStore();
  if (!store) {
    return (
      <Card>
        <p className="text-sm text-muted">Conecte a loja na página inicial para usar o simulador.</p>
      </Card>
    );
  }
  const sp = await searchParams;
  const db = { query };
  const q = (sp.q ?? "").trim().slice(0, 100);
  const [produto, achados, minimo] = await Promise.all([sp.produto ? produtoParaSimular(db, store.id, sp.produto) : null, q ? buscarParaSimular(db, store.id, q) : [], margemMinima(db, store.id)]);

  // Sem valor digitado, parte do produto escolhido: preço cheio e custo cadastrado.
  const preco = sp.preco !== undefined ? numeroBR(sp.preco) : (produto?.preco ?? null);
  const custo = sp.custo !== undefined ? numeroBR(sp.custo) : (produto?.custo ?? null);
  const taxa = numeroBR(sp.taxa) ?? 0;
  const imposto = numeroBR(sp.imposto) ?? 0;
  const extra = numeroBR(sp.extra) ?? 0;
  const margemAlvo = numeroBR(sp.alvo);
  let erro: string | null = null;
  let r: ReturnType<typeof simular> | null = null;
  if (preco !== null && custo !== null) {
    try {
      r = simular({ preco, custo, taxaPct: taxa, impostoPct: imposto, extra, margemAlvoPct: margemAlvo });
    } catch (e) {
      erro = e instanceof SimuladorErro ? e.message : "Não consegui calcular com esses valores.";
    }
  }
  const margemBaixa = r !== null && r.base.margem !== null && minimo > 0 && r.base.margem < minimo;

  return (
    <main className="flex max-w-4xl flex-col gap-4 pb-24">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Simulador de preço</h1>
        <p className="text-sm text-muted">
          Informe o preço e o custo (ou escolha um produto, que já traz o custo cadastrado em <Link href="/custos" className="underline">Custos</Link>) e veja o lucro por peça, a margem, o preço mínimo e o que uma promoção faz com o lucro. Nada é gravado: é só uma conta.
        </p>
      </div>

      <Card className="flex flex-col gap-3">
        <form method="get" action="/simulador" className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-56 flex-1 flex-col gap-1 text-sm">
            <span className="font-medium">Buscar produto (nome ou SKU)</span>
            <input name="q" defaultValue={q} maxLength={100} placeholder="ex.: vestido azul" className={fieldBase} />
          </label>
          <Button type="submit" variant="outline">
            Buscar
          </Button>
        </form>
        {q && (
          <ul className="divide-y divide-border text-sm">
            {achados.length === 0 && <li className="py-2 text-muted">Nenhum produto encontrado.</li>}
            {achados.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {p.nome} {!p.publicado && <Badge tone="neutral">Não publicado</Badge>}
                  <span className="text-muted">
                    {" "}
                    · {p.preco !== null ? brl(p.preco) : "sem preço"} · {p.custo !== null ? `custo ${brl(p.custo)}` : "sem custo"}
                  </span>
                </span>
                <Link href={`/simulador?produto=${p.id}`} className="underline">
                  Simular
                </Link>
              </li>
            ))}
          </ul>
        )}
        {produto && (
          <p className="text-sm">
            Produto: <Link href={`/produtos/${produto.id}`} className="font-medium underline">{produto.nome}</Link>
            {produto.precoPromocional !== null && <span className="text-muted"> · hoje em promoção por {brl(produto.precoPromocional)} (a simulação usa o preço cheio)</span>}
            {produto.custo === null && <span className="text-warning"> · sem custo cadastrado: digite o custo abaixo</span>}
          </p>
        )}
      </Card>

      <form method="get" action="/simulador">
        {produto && <input type="hidden" name="produto" value={produto.id} />}
        <Card className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Preço de venda (R$)</span>
              <input name="preco" inputMode="decimal" defaultValue={campo(sp.preco) || (preco !== null ? numero(preco) : "")} className={fieldBase} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Custo da peça (R$)</span>
              <input name="custo" inputMode="decimal" defaultValue={campo(sp.custo) || (custo !== null ? numero(custo) : "")} className={fieldBase} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Taxa de pagamento (%)</span>
              <input name="taxa" inputMode="decimal" defaultValue={campo(sp.taxa)} placeholder="0" className={fieldBase} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Impostos (%)</span>
              <input name="imposto" inputMode="decimal" defaultValue={campo(sp.imposto)} placeholder="0" className={fieldBase} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Outras despesas por peça (R$)</span>
              <input name="extra" inputMode="decimal" defaultValue={campo(sp.extra)} placeholder="embalagem, frete…" className={fieldBase} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Margem desejada (%)</span>
              <input name="alvo" inputMode="decimal" defaultValue={campo(sp.alvo)} placeholder={minimo > 0 ? numero(minimo) : "ex.: 40"} className={fieldBase} />
            </label>
          </div>
          <div>
            <Button type="submit">Calcular</Button>
          </div>
          <p className="text-xs text-muted">Taxa e impostos são percentuais do preço; as outras despesas são um valor fixo por peça vendida. Use vírgula ou ponto nos decimais.</p>
        </Card>
      </form>

      {erro && (
        <p role="alert" className="rounded-md border border-border bg-card p-3 text-sm text-danger">
          {erro}
        </p>
      )}

      {r && (
        <>
          <section aria-label="Resultado" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card className="flex flex-col gap-1">
              <span className="text-xs text-muted">Lucro por peça</span>
              <span className={`text-2xl font-semibold ${r.base.lucro < 0 ? "text-danger" : ""}`}>{brl(r.base.lucro)}</span>
            </Card>
            <Card className="flex flex-col gap-1">
              <span className="text-xs text-muted">Margem (sobre o preço)</span>
              <span className="text-2xl font-semibold">{pct(r.base.margem)}</span>
              {margemBaixa && <span className="text-xs text-warning">abaixo da margem mínima de {pct(minimo)} (Custos)</span>}
            </Card>
            <Card className="flex flex-col gap-1">
              <span className="text-xs text-muted">Preço de equilíbrio</span>
              <span className="text-2xl font-semibold">{brl(r.equilibrio)}</span>
              <span className="text-xs text-muted">abaixo disso dá prejuízo</span>
            </Card>
            <Card className="flex flex-col gap-1">
              <span className="text-xs text-muted">{r.precoMargemAlvo !== null ? `Preço para ${pct(margemAlvo)} de margem` : "Desconto máximo sem prejuízo"}</span>
              <span className="text-2xl font-semibold">{r.precoMargemAlvo !== null ? brl(r.precoMargemAlvo) : pct(r.descontoMaximoSemPrejuizo)}</span>
              {r.precoMargemAlvo !== null && <span className="text-xs text-muted">desconto máximo sem prejuízo: {pct(r.descontoMaximoSemPrejuizo)}</span>}
            </Card>
          </section>

          <Card className="flex flex-col gap-2">
            <h2 className="font-medium">O que uma promoção faz</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-xs text-muted">
                    <th className="py-1 pr-3 font-medium">Cenário</th>
                    <th className="py-1 pr-3 font-medium">Preço</th>
                    <th className="py-1 pr-3 font-medium">Lucro por peça</th>
                    <th className="py-1 pr-3 font-medium">Margem</th>
                    <th className="py-1 font-medium">Vendas para ganhar o mesmo</th>
                  </tr>
                </thead>
                <tbody>
                  <Linha c={r.base} destaque />
                  {r.cenarios.map((c) => (
                    <Linha key={c.desconto} c={c} />
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted">“Vendas para ganhar o mesmo” é quantas vezes mais peças você precisa vender com o desconto para ter o mesmo lucro total do preço cheio (2× = o dobro de vendas). Uma promoção só compensa se as vendas crescerem mais do que isso.</p>
          </Card>
        </>
      )}

      {!r && !erro && <p className="text-sm text-muted">Escolha um produto ou digite o preço e o custo e clique em Calcular.</p>}
    </main>
  );
}
