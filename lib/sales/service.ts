import "server-only";
import { query } from "@/lib/db";
import { listOrdersPage } from "@/lib/nuvemshop";
import { clientForStore, getActiveStore } from "@/lib/stores";
import { passoVendas, type FontePedidos, type PassoVendas } from "./sync";

export class SemLojaError extends Error {
  constructor() {
    super("Nenhuma loja conectada. Conecte a loja Nuvemshop primeiro.");
  }
}

/** Um passo da leitura de vendas da loja ativa. Registra no Histórico só números. */
export async function passoVendasDaLoja(args: { page?: number; runId?: string; janelaDias?: number; budgetMs: number; actor: string }): Promise<PassoVendas> {
  const store = await getActiveStore();
  if (!store) throw new SemLojaError();
  const client = await clientForStore(store);
  const fonte: FontePedidos = {
    listPage: async (page, desde) => {
      const r = await listOrdersPage(client, { page, created_at_min: desde });
      return { items: r.items, nextPage: r.nextPage, invalidos: r.invalidos, campos: r.campos };
    },
  };
  const passo = await passoVendas({ query }, fonte, { storeId: store.id, page: args.page, runId: args.runId, janelaDias: args.janelaDias, budgetMs: args.budgetMs });
  if (passo.concluido) {
    await query(`INSERT INTO audit_log (store_id, actor_email, acao, entidade, depois) VALUES ($1::uuid, $2, 'venda.sincronizar', 'venda', $3::jsonb)`, [
      store.id,
      args.actor,
      JSON.stringify({ janela_dias: args.janelaDias ?? null }),
    ]);
  }
  return passo;
}
