import Link from "next/link";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/admin";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { query } from "@/lib/db";
import { coberturaDosPedidos } from "@/lib/orders/stats";
import { ultimaSincronizacaoPedidos } from "@/lib/orders/sync";
import { classificarReposicao, textoDias, variacoesComRitmo, type LinhaReposicao } from "@/lib/stock/insights";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";

const JANELAS = [14, 30, 60, 90] as const;
const LIMITES = [7, 14, 21, 30] as const;
const COBERTURAS = [30, 45, 60] as const;
const opcao = <T extends readonly number[]>(lista: T, padrao: T[number]) => z.coerce.number().int().refine((n) => (lista as readonly number[]).includes(n)).catch(padrao);
const paramsSchema = z.object({ janela: opcao(JANELAS, 30), limite: opcao(LIMITES, 14), cobertura: opcao(COBERTURAS, 30) });

const LIMITE_LINHAS = 60;

function Tabela({ linhas, vazio }: { linhas: LinhaReposicao[]; vazio: string }) {
  if (linhas.length === 0) return <p className="text-sm text-muted">{vazio}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-xs text-muted">
            <th className="py-1 pr-3 font-medium">Produto</th>
            <th className="py-1 pr-3 font-medium">Variação</th>
            <th className="py-1 pr-3 text-right font-medium">Estoque</th>
            <th className="py-1 pr-3 text-right font-medium">Vendeu</th>
            <th className="py-1 pr-3 text-right font-medium">Acaba em</th>
            <th className="py-1 text-right font-medium">Repor</th>
          </tr>
        </thead>
        <tbody>
          {linhas.slice(0, LIMITE_LINHAS).map((l) => (
            <tr key={l.variant_id} className="border-t border-border align-top">
              <td className="py-2 pr-3">
                <Link href={`/produtos/${l.product_id}`} className="font-medium hover:underline">
                  {l.produto}
                </Link>
                {!l.publicado && (
                  <>
                    {" "}
                    <Badge>Despublicado</Badge>
                  </>
                )}
              </td>
              <td className="py-2 pr-3">{l.variacao}</td>
              <td className="py-2 pr-3 text-right">{l.estoque}</td>
              <td className="py-2 pr-3 text-right">{l.vendidas}</td>
              <td className="py-2 pr-3 text-right">{l.diasRestantes === null ? "Esgotado" : textoDias(l.diasRestantes)}</td>
              <td className="py-2 text-right font-medium">{l.sugerido}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {linhas.length > LIMITE_LINHAS && <p className="mt-2 text-xs text-muted">Mostrando {LIMITE_LINHAS} de {linhas.length}; a planilha traz todas.</p>}
    </div>
  );
}

export default async function EstoquePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const store = await getActiveStore();
  if (!store) {
    return (
      <Card>
        <p className="text-sm text-muted">Conecte a loja na página inicial para ver o estoque.</p>
      </Card>
    );
  }
  const sp = paramsSchema.parse(await searchParams);
  const db = { query };
  const ultima = await ultimaSincronizacaoPedidos(db, store.id);
  const cobertura = await coberturaDosPedidos(db, store.id);
  const vars = ultima ? await variacoesComRitmo(db, store.id, sp.janela) : [];
  const { acabando, esgotados } = classificarReposicao(vars, { limite: sp.limite, cobertura: sp.cobertura });
  const href = (over: Partial<typeof sp>) => {
    const n = { ...sp, ...over };
    return `/estoque?janela=${n.janela}&limite=${n.limite}&cobertura=${n.cobertura}`;
  };
  const pill = (ativo: boolean) => `rounded-full border px-3 py-1 ${ativo ? "border-primary bg-primary text-primary-foreground" : "border-border-strong hover:bg-border/40"}`;
  const Opcoes = ({ titulo, lista, atual, chave, sufixo }: { titulo: string; lista: readonly number[]; atual: number; chave: "janela" | "limite" | "cobertura"; sufixo: string }) => (
    <nav aria-label={titulo} className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted">{titulo}:</span>
      {lista.map((n) => (
        <Link key={n} href={href({ [chave]: n })} aria-current={atual === n ? "page" : undefined} className={pill(atual === n)}>
          {n} {sufixo}
        </Link>
      ))}
    </nav>
  );

  return (
    <main className="flex max-w-5xl flex-col gap-4 pb-20">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Estoque inteligente</h1>
          <p className="text-sm text-muted">O que está acabando e o que esgotou mas vendia bem, contra o ritmo de vendas dos pedidos pagos. Só variações com controle de estoque.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/automacoes" className={buttonClass("outline")}>
            Automações de estoque
          </Link>
          {ultima && (
            <a href={`/api/estoque/exportar?janela=${sp.janela}&limite=${sp.limite}&cobertura=${sp.cobertura}`} className={buttonClass("outline")} download>
              Exportar Excel
            </a>
          )}
        </div>
      </div>

      {!ultima ? (
        <Card className="flex flex-col gap-2">
          <p className="text-sm text-muted">Para calcular o ritmo de venda, o painel precisa dos pedidos da loja.</p>
          <div>
            <Link href="/vendas" className={buttonClass("primary")}>
              Ler os pedidos em Vendas
            </Link>
          </div>
        </Card>
      ) : (
        <>
          <Card className="flex flex-col gap-3">
            <Opcoes titulo="Ritmo medido nos últimos" lista={JANELAS} atual={sp.janela} chave="janela" sufixo="dias" />
            <Opcoes titulo="Acabando em até" lista={LIMITES} atual={sp.limite} chave="limite" sufixo="dias" />
            <Opcoes titulo="Repor para cobrir" lista={COBERTURAS} atual={sp.cobertura} chave="cobertura" sufixo="dias" />
            <p className="text-xs text-muted">
              Pedidos lidos até {cobertura.ultimo ? cobertura.ultimo.split("-").reverse().join("/") : "—"}. O ritmo é o total vendido da variação na janela dividido pelos dias; “Repor” = ritmo × dias a cobrir − estoque atual.
            </p>
          </Card>

          <section aria-label="Resumo" className="grid grid-cols-2 gap-3">
            <Card className="flex flex-col gap-1">
              <p className="text-sm text-muted">Acabando em até {sp.limite} dias</p>
              <p className="text-2xl font-semibold">{acabando.length}</p>
            </Card>
            <Card className="flex flex-col gap-1">
              <p className="text-sm text-muted">Esgotadas que vendiam</p>
              <p className="text-2xl font-semibold">{esgotados.length}</p>
            </Card>
          </section>

          <Card className="flex flex-col gap-3">
            <h2 className="font-medium">Repor primeiro: esgotadas que vendiam</h2>
            <Tabela linhas={esgotados} vazio="Nenhuma variação esgotada vendeu nesta janela." />
          </Card>

          <Card className="flex flex-col gap-3">
            <h2 className="font-medium">Acabando em breve</h2>
            <Tabela linhas={acabando} vazio={`Nenhuma variação acaba em até ${sp.limite} dias no ritmo atual.`} />
          </Card>
          <p className="text-xs text-muted">Se a lista vier vazia mesmo havendo vendas, os pedidos da loja podem não trazer a variação de cada item; nesse caso me avise.</p>
        </>
      )}
    </main>
  );
}
