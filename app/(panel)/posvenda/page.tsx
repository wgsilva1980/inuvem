import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin";
import { Card } from "@/components/ui/card";
import { query } from "@/lib/db";
import { ultimaSincronizacaoPedidos } from "@/lib/orders/sync";
import { contarPosVenda, pedidosParaPosVenda, resultadoDoPosVenda } from "@/lib/postsale/repo";
import { ESPERAS_DIAS, JANELA_MAXIMA_DIAS, JANELA_RESULTADO_DIAS, MAX_LISTA, TIPOS, esperaValida, type TipoMensagem } from "@/lib/postsale/rules";
import { getActiveStore } from "@/lib/stores";
import { SincronizarPedidos } from "../vendas/sincronizar-pedidos";
import { Lista, type Linha } from "./lista";

export const dynamic = "force-dynamic";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default async function PosVendaPage({ searchParams }: { searchParams: Promise<{ dias?: string }> }) {
  await requireAdmin();
  const dias = esperaValida((await searchParams).dias);
  const store = await getActiveStore();
  if (!store) {
    return (
      <Card>
        <p className="text-sm text-muted">Conecte a loja na página inicial para usar o pós-venda.</p>
      </Card>
    );
  }
  const db = { query };
  const ultima = await ultimaSincronizacaoPedidos(db, store.id);
  const [pedidos, total, resultado] = ultima ? await Promise.all([pedidosParaPosVenda(db, store.id, dias), contarPosVenda(db, store.id, dias), resultadoDoPosVenda(db, store.id)]) : [[], 0, { avisadas: 0, voltaram: 0, faturamento: 0 }];
  const linhas: Linha[] = pedidos.map((p) => ({
    orderId: p.orderId,
    numero: p.numero,
    nome: p.nome,
    local: [p.cidade, p.uf].filter(Boolean).join("/") || null,
    total: p.total,
    enviadoEm: p.enviadoEm,
    diasDesdeEnvio: p.diasDesdeEnvio,
    temWhatsapp: p.temWhatsapp,
    temEmail: p.temEmail,
  }));
  const tipos = (Object.keys(TIPOS) as TipoMensagem[]).map((id) => ({ id, rotulo: TIPOS[id].rotulo }));

  return (
    <main className="flex max-w-4xl flex-col gap-4 pb-24">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Pós-venda</h1>
        <p className="text-sm text-muted">
          Clientes com pedido enviado há alguns dias: uma mensagem curta perguntando se deu tudo certo, ou pedindo a avaliação. O painel não envia nada: monta o texto, você manda pelo WhatsApp ou e-mail e marca como feito. Quem recusou receber contato, e quem já comprou de novo, não aparece.
        </p>
      </div>

      {!ultima && (
        <Card className="flex flex-col gap-2">
          <p className="text-sm text-muted">Os pedidos ainda não foram lidos. Leia os pedidos para ver quem recebeu a encomenda.</p>
          <SincronizarPedidos ultima={ultima} />
        </Card>
      )}

      <nav aria-label="Dias desde o envio" className="flex flex-wrap gap-2 text-sm">
        {ESPERAS_DIAS.map((d) => (
          <Link key={d} href={`/posvenda?dias=${d}`} aria-current={d === dias ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-md border px-3 ${d === dias ? "border-foreground font-medium" : "border-border"}`}>
            Enviado há {d}+ dias
          </Link>
        ))}
      </nav>

      {ultima && (
        <>
          <section aria-label="Resumo" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Card className="flex flex-col gap-1">
              <span className="text-xs text-muted">Para fazer o pós-venda</span>
              <span className="text-lg font-semibold">{total}</span>
              {total > MAX_LISTA && <span className="text-xs text-muted">Mostrando as {MAX_LISTA} maiores compras.</span>}
            </Card>
            <Card className="flex flex-col gap-1">
              <span className="text-xs text-muted">Avisadas nos últimos {JANELA_RESULTADO_DIAS} dias</span>
              <span className="text-lg font-semibold">{resultado.avisadas}</span>
            </Card>
            <Card className="flex flex-col gap-1">
              <span className="text-xs text-muted">Compraram de novo depois do aviso</span>
              <span className="text-lg font-semibold">
                {resultado.voltaram}
                {resultado.avisadas > 0 ? ` (${Math.round((resultado.voltaram / resultado.avisadas) * 100)}%)` : ""}
              </span>
              {resultado.voltaram > 0 && <span className="text-xs text-muted">{brl(resultado.faturamento)} em pedidos pagos</span>}
            </Card>
          </section>
          <Lista linhas={linhas} tipos={tipos} />
          <p className="text-xs text-muted">
            A Nuvemshop não informa o dia da entrega, só que o pedido foi despachado: o painel usa o dia em que você marcou o envio (ou, para envios feitos direto na Nuvemshop, a última atualização do pedido). Entram pedidos enviados há no máximo {JANELA_MAXIMA_DIAS} dias. “Compraram de novo” conta quem fez um pedido pago depois do aviso; não prova que o aviso trouxe a compra.
          </p>
        </>
      )}
    </main>
  );
}
