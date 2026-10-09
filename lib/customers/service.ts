import "server-only";
import { query } from "@/lib/db";
import { listCustomers } from "@/lib/nuvemshop";
import { clientForStore, getActiveStore } from "@/lib/stores";
import { passoClientes, type FonteClientes, type PassoClientes } from "./sync";

export class SemLojaError extends Error {
  constructor() {
    super("Nenhuma loja conectada. Conecte a loja Nuvemshop primeiro.");
  }
}

/** Um passo da sincronização de clientes da loja ativa. Registra no Histórico só números (nunca dados dos clientes). */
export async function passoClientesDaLoja(args: { page?: number; completo?: boolean; inicio?: string; budgetMs: number; actor: string }): Promise<PassoClientes> {
  const store = await getActiveStore();
  if (!store) throw new SemLojaError();
  const client = await clientForStore(store);
  const fonte: FonteClientes = {
    listPage: async (page, desde) => {
      const r = await listCustomers(client, { page, ...(desde ? { updated_at_min: desde } : {}) });
      return { items: r.items, nextPage: r.nextPage, invalidos: r.invalidos, campos: r.campos };
    },
  };
  const db = { query };
  const passo = await passoClientes(db, fonte, { storeId: store.id, page: args.page, completo: args.completo, inicio: args.inicio, budgetMs: args.budgetMs });
  await db.query(
    `INSERT INTO audit_log (store_id, actor_email, acao, entidade, depois) VALUES ($1::uuid, $2, 'cliente.sincronizar', 'cliente', $3::jsonb)`,
    [
      store.id,
      args.actor,
      JSON.stringify({ lidos: passo.lidos, novos: passo.novos, atualizados: passo.atualizados, vinculados: passo.vinculados, criados: passo.criados, preenchidos: passo.preenchidos, incremental: passo.incremental, concluido: passo.concluido }),
    ],
  );
  return passo;
}
