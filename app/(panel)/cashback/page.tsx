import { requireAdmin } from "@/lib/auth/admin";
import { Card } from "@/components/ui/card";
import { gastoDoMes, listarGrants, obterConfig, pedidosElegiveis } from "@/lib/cashback/repo";
import { situacaoDosCupons } from "@/lib/cashback/service";
import { query } from "@/lib/db";
import { ultimaSincronizacaoPedidos } from "@/lib/orders/sync";
import { clientForStore, getActiveStore } from "@/lib/stores";
import { SincronizarPedidos } from "../vendas/sincronizar-pedidos";
import { Elegiveis } from "./elegiveis";
import { Emitidos, type Emitido } from "./emitidos";
import { RegrasForm } from "./regras-form";

export const dynamic = "force-dynamic";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default async function CashbackPage() {
  await requireAdmin();
  const store = await getActiveStore();
  if (!store) {
    return (
      <Card>
        <p className="text-sm text-muted">Conecte a loja na página inicial para usar o cashback.</p>
      </Card>
    );
  }
  const db = { query };
  const ultima = await ultimaSincronizacaoPedidos(db, store.id);
  const config = await obterConfig(db, store.id);
  const gasto = await gastoDoMes(db, store.id);
  const restante = Math.max(0, config.monthBudget - gasto);
  const elegiveis = ultima ? await pedidosElegiveis(db, store.id, config) : [];
  const grants = await listarGrants(db, store.id);
  const { porPedido, lido } = grants.length > 0 ? await situacaoDosCupons(await clientForStore(store), grants) : { porPedido: new Map(), lido: true };
  const emitidos: Emitido[] = grants.map((g) => {
    const s = porPedido.get(g.order_id) ?? { situacao: "desconhecida", usado: false };
    return {
      orderId: g.order_id,
      numero: g.order_number,
      codigo: g.coupon_code,
      valor: Number(g.value),
      validade: g.expires_on,
      emitidoEm: g.issued_at,
      contatada: g.contacted_at !== null,
      situacao: s.situacao,
      usado: s.usado || s.situacao === "esgotado",
    };
  });

  return (
    <main className="flex max-w-4xl flex-col gap-4 pb-24">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Cashback</h1>
        <p className="text-sm text-muted">
          Um cupom de valor fixo, de uso único, para a cliente voltar depois de uma compra. Nada é automático: o painel propõe os pedidos, você escolhe e confirma. Cada cupom tem teto, validade e compra mínima, e o total do mês tem um limite.
        </p>
      </div>

      <section aria-label="Orçamento do mês" className="grid grid-cols-2 gap-3">
        <Card className="flex flex-col gap-1">
          <p className="text-sm text-muted">Emitido neste mês</p>
          <p className="text-2xl font-semibold">{brl(gasto)}</p>
        </Card>
        <Card className="flex flex-col gap-1">
          <p className="text-sm text-muted">Resta do orçamento ({brl(config.monthBudget)})</p>
          <p className={`text-2xl font-semibold ${restante === 0 ? "text-danger" : ""}`}>{brl(restante)}</p>
        </Card>
      </section>

      <RegrasForm config={config} />

      <Card className="flex flex-col gap-2">
        <SincronizarPedidos ultima={ultima} />
      </Card>

      {ultima ? (
        <Elegiveis itens={elegiveis} restante={restante} />
      ) : (
        <Card>
          <p className="text-sm text-muted">Leia os pedidos da loja (acima) para ver quem pode ganhar cashback.</p>
        </Card>
      )}

      <Emitidos itens={emitidos} lido={lido} />

      <Card className="text-sm text-muted">
        <p className="font-medium text-foreground">Regras fixas</p>
        <ul className="list-disc pl-5">
          <li>Só pedidos pagos e não cancelados, de clientes identificadas, dos últimos 60 dias e já passada a espera.</li>
          <li>Uma cliente ganha um cupom por vez: só depois de 60 dias do anterior (cupons cancelados não contam).</li>
          <li>Pedidos com dois ou mais sinais de risco ficam retidos para conferência e não recebem cupom.</li>
          <li>Antes de criar cada cupom o painel relê o pedido na loja e confere que ele continua pago e ativo.</li>
        </ul>
      </Card>
    </main>
  );
}
