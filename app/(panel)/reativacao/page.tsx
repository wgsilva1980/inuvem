import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin";
import { Card } from "@/components/ui/card";
import { query } from "@/lib/db";
import { ultimaSincronizacaoPedidos } from "@/lib/orders/sync";
import { clientesInativas, contarInativas, resultadoDaReativacao } from "@/lib/reactivation/repo";
import { FAIXAS_DIAS, JANELA_RESULTADO_DIAS, MAX_LISTA, diasValidos } from "@/lib/reactivation/rules";
import { getActiveStore } from "@/lib/stores";
import { SincronizarPedidos } from "../vendas/sincronizar-pedidos";
import { Lista, type Linha } from "./lista";

export const dynamic = "force-dynamic";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default async function ReativacaoPage({ searchParams }: { searchParams: Promise<{ dias?: string }> }) {
  await requireAdmin();
  const dias = diasValidos((await searchParams).dias);
  const store = await getActiveStore();
  if (!store) {
    return (
      <Card>
        <p className="text-sm text-muted">Conecte a loja na página inicial para usar a reativação de clientes.</p>
      </Card>
    );
  }
  const db = { query };
  const ultima = await ultimaSincronizacaoPedidos(db, store.id);
  const [inativas, total, resultado] = ultima ? await Promise.all([clientesInativas(db, store.id, dias), contarInativas(db, store.id, dias), resultadoDaReativacao(db, store.id)]) : [[], 0, { avisadas: 0, voltaram: 0, faturamento: 0 }];
  const linhas: Linha[] = inativas.map((c) => ({
    id: c.id,
    nome: c.nome,
    local: [c.cidade, c.uf].filter(Boolean).join("/") || null,
    ultimaCompra: c.ultimaCompra,
    diasSemComprar: c.diasSemComprar,
    pedidos: c.pedidos,
    totalGasto: c.totalGasto,
    temWhatsapp: c.temWhatsapp,
    temEmail: c.temEmail,
  }));

  return (
    <main className="flex max-w-4xl flex-col gap-4 pb-24">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Reativação de clientes</h1>
        <p className="text-sm text-muted">
          Clientes que já compraram e não voltam há um tempo, das que mais gastaram para as que menos. O painel não envia nada: monta o texto, você manda pelo WhatsApp ou e-mail e marca como avisada. Quem recusou receber contato não aparece.
        </p>
      </div>

      {!ultima && (
        <Card className="flex flex-col gap-2">
          <p className="text-sm text-muted">Os pedidos ainda não foram lidos. Leia os pedidos para ver quem está sem comprar.</p>
          <SincronizarPedidos ultima={ultima} />
        </Card>
      )}

      <nav aria-label="Tempo sem comprar" className="flex flex-wrap gap-2 text-sm">
        {FAIXAS_DIAS.map((d) => (
          <Link key={d} href={`/reativacao?dias=${d}`} aria-current={d === dias ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-md border px-3 ${d === dias ? "border-foreground font-medium" : "border-border"}`}>
            Há mais de {d} dias
          </Link>
        ))}
      </nav>

      {ultima && (
        <>
          <section aria-label="Resumo" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Card className="flex flex-col gap-1">
              <span className="text-xs text-muted">Sem comprar há mais de {dias} dias</span>
              <span className="text-lg font-semibold">{total}</span>
              {total > MAX_LISTA && <span className="text-xs text-muted">Mostrando as {MAX_LISTA} que mais gastaram.</span>}
            </Card>
            <Card className="flex flex-col gap-1">
              <span className="text-xs text-muted">Avisadas nos últimos {JANELA_RESULTADO_DIAS} dias</span>
              <span className="text-lg font-semibold">{resultado.avisadas}</span>
            </Card>
            <Card className="flex flex-col gap-1">
              <span className="text-xs text-muted">Voltaram a comprar depois do aviso</span>
              <span className="text-lg font-semibold">
                {resultado.voltaram}
                {resultado.avisadas > 0 ? ` (${Math.round((resultado.voltaram / resultado.avisadas) * 100)}%)` : ""}
              </span>
              {resultado.voltaram > 0 && <span className="text-xs text-muted">{brl(resultado.faturamento)} em pedidos pagos</span>}
            </Card>
          </section>
          <Lista linhas={linhas} />
          <p className="text-xs text-muted">“Voltaram” conta quem fez um pedido pago depois de ser marcada como avisada; é uma medida simples e não prova que foi o aviso que trouxe a compra.</p>
        </>
      )}
    </main>
  );
}
