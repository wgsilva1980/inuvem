import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin";
import { Card } from "@/components/ui/card";
import { query } from "@/lib/db";
import { ultimaSincronizacaoPedidos } from "@/lib/orders/sync";
import { filaDeExpedicao } from "@/lib/shipping/queue";
import { getActiveStore } from "@/lib/stores";
import { SincronizarPedidos } from "../../vendas/sincronizar-pedidos";
import { Conferencia } from "./conferencia";

export const dynamic = "force-dynamic";

/** Conferência da expedição pensada para o celular: lê as peças de cada pedido por código de barras/SKU e marca como enviado. */
export default async function ConferirPage() {
  await requireAdmin("expedicao");
  const store = await getActiveStore();
  if (!store) {
    return (
      <Card>
        <p className="text-sm text-muted">Conecte a loja na página inicial para conferir pedidos.</p>
      </Card>
    );
  }
  const db = { query };
  const ultima = await ultimaSincronizacaoPedidos(db, store.id);
  const fila = ultima ? await filaDeExpedicao(db, store.id, 2) : [];

  return (
    <main className="flex max-w-xl flex-col gap-4 pb-24">
      <div className="flex flex-col gap-1">
        <Link href="/expedicao" className="text-sm text-muted hover:underline">
          ← Expedição
        </Link>
        <h1 className="text-xl font-semibold">Conferir pedido</h1>
        <p className="text-sm text-muted">Escolha o pedido, leia o código de cada peça que entra no pacote e, quando tudo bater, informe o rastreio e marque como enviado. As peças são conferidas pelo SKU ou pelo código de barras cadastrado na loja.</p>
      </div>
      <Card className="flex flex-col gap-2">
        <SincronizarPedidos ultima={ultima} />
      </Card>
      {!ultima ? (
        <Card>
          <p className="text-sm text-muted">Leia os pedidos da loja para montar a fila.</p>
        </Card>
      ) : (
        <Conferencia
          pedidos={fila.map((p) => ({
            id: p.id,
            numero: p.numero,
            diasParado: p.diasParado,
            atrasado: p.atrasado,
            rastreio: p.rastreio,
            itens: p.itens.map((i) => ({ nome: i.nome, variacao: i.variacao, sku: i.sku, barras: i.barras, quantidade: i.quantidade, foto: i.foto })),
          }))}
        />
      )}
    </main>
  );
}
