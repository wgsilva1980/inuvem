import "server-only";
import { getEnv } from "@/lib/env";
import { query } from "@/lib/db";
import { listAllCategories, listProducts } from "@/lib/nuvemshop";
import { clientForStore, getActiveStore } from "@/lib/stores";
import { startOrResumeRun, stepRun, type SyncRun, type SyncSource } from "./engine";

export class NoStoreError extends Error {
  constructor() {
    super("Nenhuma loja conectada. Conecte a loja Nuvemshop primeiro.");
  }
}

/** Executa um lote da sincronização (cria a execução ou retoma a que está em andamento). */
export async function syncStep(tipo: "full" | "incremental" | "auto" = "auto", budgetMs?: number): Promise<{ run: SyncRun; done: boolean }> {
  const store = await getActiveStore();
  if (!store) throw new NoStoreError();
  const client = await clientForStore(store);
  const source: SyncSource = {
    listCategories: () => listAllCategories(client),
    listProductsPage: async (p) => {
      const r = await listProducts(client, p);
      return { items: r.items, nextPage: r.nextPage };
    },
  };
  const db = { query };
  const run = await startOrResumeRun(db, store.id, tipo);
  return stepRun(db, source, run, { budgetMs: budgetMs ?? getEnv().SYNC_TIME_BUDGET_MS });
}

export function summarize(run: SyncRun) {
  return {
    id: run.id,
    tipo: run.tipo,
    status: run.status,
    page: run.cursor.page,
    totais: run.totais,
    erros: run.erros.slice(-3),
    started_at: run.started_at,
    finished_at: run.finished_at,
  };
}
