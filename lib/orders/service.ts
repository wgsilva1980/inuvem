import "server-only";
import { query } from "@/lib/db";
import { listOrdersPage } from "@/lib/nuvemshop";
import { clientForStore, getActiveStore } from "@/lib/stores";
import { passoPedidos, type FontePedidos, type PassoPedidos } from "./sync";

export class SemLojaError extends Error {
  constructor() {
    super("Nenhuma loja conectada. Conecte a loja Nuvemshop primeiro.");
  }
}

/** Um passo da sincronização dos pedidos da loja ativa. Registra no Histórico só números (nunca dados de pedidos). */
export async function passoPedidosDaLoja(args: { page?: number; completo?: boolean; inicio?: string; budgetMs: number; actor: string }): Promise<PassoPedidos> {
  const store = await getActiveStore();
  if (!store) throw new SemLojaError();
  const client = await clientForStore(store);
  const fonte: FontePedidos = {
    listPage: async (page, f) => {
      const r = await listOrdersPage(client, { page, ...(f.criadosDesde ? { created_at_min: f.criadosDesde } : {}), ...(f.atualizadosDesde ? { updated_at_min: f.atualizadosDesde } : {}) });
      return { items: r.items, nextPage: r.nextPage, invalidos: r.invalidos, campos: r.campos };
    },
  };
  const passo = await passoPedidos({ query }, fonte, { storeId: store.id, page: args.page, completo: args.completo, inicio: args.inicio, budgetMs: args.budgetMs });
  if (passo.concluido) {
    await query(`INSERT INTO audit_log (store_id, actor_email, acao, entidade, depois) VALUES ($1::uuid, $2, 'pedido.sincronizar', 'pedido', $3::jsonb)`, [
      store.id,
      args.actor,
      JSON.stringify({ lidos: passo.lidos, novos: passo.novos, atualizados: passo.atualizados, incremental: passo.incremental }),
    ]);
  }
  return passo;
}
