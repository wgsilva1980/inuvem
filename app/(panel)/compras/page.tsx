import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin";
import { Card } from "@/components/ui/card";
import { hojeEmBrasilia } from "@/lib/coupons/lote";
import { query } from "@/lib/db";
import { coberturaDosPedidos } from "@/lib/orders/stats";
import { ultimaSincronizacaoPedidos } from "@/lib/orders/sync";
import { listarPedidos } from "@/lib/purchasing/repo";
import { COBERTURAS, COBERTURA_PADRAO, JANELAS, JANELA_PADRAO, PRAZOS, PRAZO_PADRAO, escolher } from "@/lib/purchasing/rules";
import { investimento, sugestoesDeCompra } from "@/lib/purchasing/sugestoes";
import { getActiveStore } from "@/lib/stores";
import { Pedidos, type PedidoVista } from "./pedidos";
import { Sugestoes } from "./sugestoes";

export const dynamic = "force-dynamic";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function Opcoes({ rotulo, nome, valores, atual, sufixo, params }: { rotulo: string; nome: string; valores: readonly number[]; atual: number; sufixo: string; params: Record<string, number> }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted">{rotulo}</span>
      <div className="flex flex-wrap gap-1.5">
        {valores.map((v) => {
          const qs = new URLSearchParams(Object.entries({ ...params, [nome]: v }).map(([k, x]) => [k, String(x)]));
          return (
            <Link key={v} href={`/compras?${qs}`} aria-current={v === atual ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-md border px-3 text-sm ${v === atual ? "border-foreground font-medium" : "border-border"}`}>
              {v} {sufixo}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export default async function ComprasPage({ searchParams }: { searchParams: Promise<{ aba?: string; janela?: string; prazo?: string; cobertura?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const store = await getActiveStore();
  if (!store) {
    return (
      <Card>
        <p className="text-sm text-muted">Conecte a loja na página inicial para planejar compras.</p>
      </Card>
    );
  }
  const aba = sp.aba === "pedidos" ? "pedidos" : "sugestao";
  const params = { janela: escolher(JANELAS, sp.janela, JANELA_PADRAO), prazo: escolher(PRAZOS, sp.prazo, PRAZO_PADRAO), cobertura: escolher(COBERTURAS, sp.cobertura, COBERTURA_PADRAO) };
  const db = { query };
  const hoje = hojeEmBrasilia();

  return (
    <main className="flex max-w-5xl flex-col gap-4 pb-24">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Compras e reposição</h1>
        <p className="text-sm text-muted">
          A lista do que comprar (pelo ritmo de vendas, o estoque e o que já está a caminho), os pedidos aos fornecedores e a entrada da mercadoria no estoque da loja. O painel só altera o estoque da loja quando você pede, ao receber um pedido.
        </p>
      </div>
      <nav aria-label="Compras" className="flex gap-2 text-sm">
        {([["sugestao", "Sugestão de compra", "/compras"], ["pedidos", "Pedidos de compra", "/compras?aba=pedidos"]] as const).map(([k, r, href]) => (
          <Link key={k} href={href} aria-current={aba === k ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-full border px-4 ${aba === k ? "border-primary bg-primary text-primary-foreground" : "border-border-strong hover:bg-border/40"}`}>
            {r}
          </Link>
        ))}
      </nav>
      {aba === "pedidos" ? <PedidosAba storeId={store.id} hoje={hoje} /> : <SugestaoAba storeId={store.id} params={params} db={db} />}
    </main>
  );
}

async function PedidosAba({ storeId, hoje }: { storeId: string; hoje: string }) {
  const lista = await listarPedidos({ query }, storeId);
  const pedidos: PedidoVista[] = lista.map((p) => ({
    id: p.id, fornecedor: p.fornecedor, previsto: p.previsto, atrasado: p.status === "aberto" && p.previsto !== null && p.previsto < hoje, observacao: p.observacao, status: p.status, estoqueAtualizado: p.estoqueAtualizado,
    criadoEm: p.criadoEm, total: p.total, semCusto: p.semCusto, itens: p.itens.map((i) => ({ seq: i.seq, productId: i.productId, produto: i.produto, variacao: i.variacao, qty: i.qty, recebido: i.recebido })),
  }));
  return <Pedidos pedidos={pedidos} />;
}

async function SugestaoAba({ storeId, params, db }: { storeId: string; params: { janela: number; prazo: number; cobertura: number }; db: { query: typeof query } }) {
  const ultima = await ultimaSincronizacaoPedidos(db, storeId);
  if (!ultima) {
    return (
      <Card>
        <p className="text-sm text-muted">Os pedidos ainda não foram lidos, e a sugestão depende do ritmo de vendas. Leia os pedidos em Vendas e volte aqui.</p>
      </Card>
    );
  }
  const [linhas, cobertura] = await Promise.all([sugestoesDeCompra(db, storeId, params), coberturaDosPedidos(db, storeId)]);
  const diasCobertos = cobertura.primeiro ? Math.floor((Date.parse(`${hojeEmBrasilia()}T00:00:00Z`) - Date.parse(`${cobertura.primeiro}T00:00:00Z`)) / 86_400_000) : null;
  const inv = investimento(linhas);
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  return (
    <>
      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <Opcoes rotulo="Ritmo de vendas dos últimos" nome="janela" valores={JANELAS} atual={params.janela} sufixo="dias" params={params} />
          <Opcoes rotulo="Prazo de entrega do fornecedor" nome="prazo" valores={PRAZOS} atual={params.prazo} sufixo="dias" params={params} />
          <Opcoes rotulo="Estoque desejado depois da chegada" nome="cobertura" valores={COBERTURAS} atual={params.cobertura} sufixo="dias" params={params} />
        </div>
        <p className="text-sm text-muted">
          {linhas.length} {linhas.length === 1 ? "variação" : "variações"} para comprar
          {inv.total > 0 && ` · investimento estimado de ${brl(inv.total)}`}
          {inv.semCusto > 0 && ` (${inv.semCusto} sem custo informado em Custos)`}. Conta: vendas por dia × (prazo + estoque desejado) − estoque − a caminho. Só entram variações publicadas, com controle de estoque, que venderam na janela.
        </p>
        {diasCobertos !== null && diasCobertos < params.janela && <p className="text-xs text-muted">Atenção: os pedidos lidos cobrem só {diasCobertos} dias; o ritmo pode estar subestimado. Releia os pedidos em Vendas.</p>}
        <div>
          <a href={`/api/compras/exportar?${qs}`} className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm hover:bg-border/40">
            Baixar a lista em planilha
          </a>
        </div>
      </Card>
      <Sugestoes
        key={qs.toString()}
        janela={params.janela}
        linhas={linhas.map((l) => ({ variantId: l.variantId, productId: l.productId, produto: l.produto, variacao: l.variacao, estoque: l.estoque, vendidas: l.vendidas, aCaminho: l.aCaminho, diasRestantes: l.diasRestantes, sugerido: l.sugerido, custo: l.custo }))}
      />
    </>
  );
}
