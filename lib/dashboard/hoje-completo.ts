import { tarefasDeCampanhas } from "@/lib/campaigns/tarefas";
import { hojeEmBrasilia } from "@/lib/coupons/lote";
import { contarPosVenda } from "@/lib/postsale/repo";
import { ESPERA_PADRAO } from "@/lib/postsale/rules";
import type { Db } from "@/lib/sync/repo";
import { ordenarTarefas, painelDoDia, type PainelDoDia, type Tarefa } from "./hoje";

/** Uma parte que falha não derruba o painel: a tarefa some e o resto aparece. */
async function seguro(fn: () => Promise<Tarefa[]>): Promise<Tarefa[]> {
  try {
    return await fn();
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "painel.hoje_completo.parte_falhou", message: err instanceof Error ? err.message : String(err) }));
    return [];
  }
}

/**
 * O painel do dia com as tarefas de campanhas (calendário) e de pós-venda, além das de `painelDoDia`. Fica separado porque as campanhas dependem
 * da data de hoje e do que está no banco (pedidos de compra, promoções): quem usa só `painelDoDia` continua com o comportamento de antes.
 */
export async function painelDoDiaCompleto(db: Db, storeId: string, agora: Date = new Date()): Promise<PainelDoDia> {
  const painel = await painelDoDia(db, storeId, agora);
  const extras = await Promise.all([
    seguro(() => tarefasDeCampanhas(db, storeId, hojeEmBrasilia(agora))),
    seguro(async () => {
      if (painel.pedidosLidosEm === null) return [];
      const n = await contarPosVenda(db, storeId, ESPERA_PADRAO);
      return n > 0 ? [{ id: "pos-venda", titulo: `${n} ${n === 1 ? "cliente" : "clientes"} para o pós-venda`, detalhe: `Pedidos enviados há ${ESPERA_PADRAO}+ dias: perguntar se deu tudo certo.`, quantidade: n, tom: "info" as const, href: "/posvenda" }] : [];
    }),
  ]);
  return { ...painel, tarefas: ordenarTarefas([...painel.tarefas, ...extras.flat()]) };
}
