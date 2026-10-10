import { pedidosElegiveis, listarGrants, obterConfig } from "@/lib/cashback/repo";
import { hojeEmBrasilia } from "@/lib/coupons/lote";
import { listarAguardandoEstoque } from "@/lib/automations/in-stock";
import { resumoDoPeriodo, somarDias, type ResumoPeriodo } from "@/lib/orders/stats";
import { ultimaSincronizacaoPedidos } from "@/lib/orders/sync";
import { listDue } from "@/lib/promotions/repo";
import { PRECISA_CONFERIR, sinaisDeRisco } from "@/lib/risk/signals";
import { filaDeExpedicao } from "@/lib/shipping/queue";
import { classificarReposicao, variacoesComRitmo } from "@/lib/stock/insights";
import type { Db } from "@/lib/sync/repo";

export type TomTarefa = "danger" | "warning" | "info";

/** Uma coisa que pede ação hoje. `href` leva à tela que resolve. */
export interface Tarefa {
  id: string;
  titulo: string;
  detalhe?: string;
  quantidade: number;
  tom: TomTarefa;
  href: string;
}

export interface VendasDoDia {
  hoje: ResumoPeriodo;
  ontem: ResumoPeriodo;
  /** Faturamento médio por dia nos 7 dias antes de hoje. */
  mediaDiaria: number;
}

export interface PainelDoDia {
  tarefas: Tarefa[];
  vendas: VendasDoDia | null;
  /** Quando os pedidos foram lidos da loja pela última vez (null = nunca). */
  pedidosLidosEm: string | null;
  /** Os pedidos estão velhos demais para confiar nos números de hoje. */
  pedidosDesatualizados: boolean;
}

/** Depois de quantas horas sem ler os pedidos os números do dia deixam de ser confiáveis. */
export const HORAS_PEDIDOS_VELHOS = 36;
const ATRASO_EXPEDICAO_DIAS = 2;
const ORDEM: Record<TomTarefa, number> = { danger: 0, warning: 1, info: 2 };

/** Uma consulta que falha não derruba a página inicial: a parte dela some e o resto aparece. */
async function seguro<T>(fn: () => Promise<T>, vazio: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "painel.hoje.parte_falhou", message: err instanceof Error ? err.message : String(err) }));
    return vazio;
  }
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/**
 * O que precisa de ação hoje, lido só do banco (nenhuma chamada à Nuvemshop): expedição, estoque, promoções, lotes, cashback e a saúde da
 * sincronização. Do mais urgente para o menos. Cada parte é independente: se uma falhar, as outras continuam.
 */
export async function painelDoDia(db: Db, storeId: string, agora: Date = new Date()): Promise<PainelDoDia> {
  const pedidosLidosEm = await seguro(() => ultimaSincronizacaoPedidos(db, storeId), null);
  const idadeHoras = pedidosLidosEm ? (agora.getTime() - Date.parse(pedidosLidosEm)) / 3_600_000 : null;
  const temPedidos = pedidosLidosEm !== null;
  const pedidosDesatualizados = idadeHoras !== null && idadeHoras > HORAS_PEDIDOS_VELHOS;
  const tarefas: Tarefa[] = [];
  const add = (t: Omit<Tarefa, "quantidade"> & { quantidade: number }) => {
    if (t.quantidade > 0) tarefas.push(t);
  };

  await Promise.all([
    // sincronização com a loja
    seguro(async () => {
      const [u] = await db.query<{ status: string; quando: string }>(
        "SELECT status, coalesce(finished_at, started_at)::text AS quando FROM sync_runs WHERE store_id = $1::uuid AND tipo <> 'webhook' ORDER BY started_at DESC LIMIT 1",
        [storeId],
      );
      if (u?.status === "failed") add({ id: "sync-falhou", titulo: "A última sincronização do catálogo falhou", detalhe: "Abra o início e sincronize de novo.", quantidade: 1, tom: "danger", href: "/" });
      else if (u && u.status !== "running" && agora.getTime() - Date.parse(u.quando) > 48 * 3_600_000) {
        add({ id: "sync-velha", titulo: "O catálogo não é sincronizado há mais de 2 dias", detalhe: "Os produtos do painel podem estar desatualizados.", quantidade: 1, tom: "warning", href: "/" });
      }
    }, undefined),

    // pedidos
    seguro(async () => {
      if (!temPedidos) add({ id: "pedidos-nunca", titulo: "Leia os pedidos da loja", detalhe: "Expedição, estoque, vendas e cashback dependem deles.", quantidade: 1, tom: "info", href: "/vendas" });
      else if (pedidosDesatualizados) add({ id: "pedidos-velhos", titulo: "Os pedidos não são lidos há mais de 36 horas", detalhe: "Atualize antes de confiar na fila e nos números.", quantidade: 1, tom: "warning", href: "/vendas" });
    }, undefined),

    // expedição
    seguro(async () => {
      if (!temPedidos) return;
      const fila = await filaDeExpedicao(db, storeId, ATRASO_EXPEDICAO_DIAS);
      const atrasados = fila.filter((p) => p.atrasado).length;
      add({ id: "exp-atrasados", titulo: `${plural(atrasados, "pedido atrasado", "pedidos atrasados")} para enviar`, detalhe: `Parados há ${ATRASO_EXPEDICAO_DIAS}+ dias.`, quantidade: atrasados, tom: "danger", href: "/expedicao?filtro=atrasados" });
      add({ id: "exp-aenviar", titulo: `${plural(fila.length - atrasados, "pedido", "pedidos")} a enviar`, quantidade: fila.length - atrasados, tom: "info", href: "/expedicao" });
      const sinais = await sinaisDeRisco(db, storeId, fila.map((p) => p.id));
      const conferir = [...sinais.values()].filter((s) => s.length >= PRECISA_CONFERIR).length;
      add({ id: "exp-conferir", titulo: `${plural(conferir, "pedido", "pedidos")} para conferir antes de enviar`, detalhe: "Dois ou mais sinais de risco.", quantidade: conferir, tom: "warning", href: "/expedicao" });
    }, undefined),

    // estoque
    seguro(async () => {
      if (!temPedidos) return;
      const { acabando, esgotados } = classificarReposicao(await variacoesComRitmo(db, storeId, 30), { limite: 7, cobertura: 30 });
      add({ id: "est-esgotados", titulo: `${plural(esgotados.length, "variação esgotada que vendia", "variações esgotadas que vendiam")}`, detalhe: "Repor primeiro.", quantidade: esgotados.length, tom: "danger", href: "/estoque" });
      add({ id: "est-acabando", titulo: `${plural(acabando.length, "variação acaba", "variações acabam")} em até 7 dias`, quantidade: acabando.length, tom: "warning", href: "/estoque" });
    }, undefined),
    seguro(async () => {
      const voltaram = (await listarAguardandoEstoque(db, storeId)).filter((a) => a.comEstoque && !a.manter).length;
      add({ id: "est-voltou", titulo: `${plural(voltaram, "produto despublicado já tem", "produtos despublicados já têm")} estoque de volta`, detalhe: "Dá para publicar de novo.", quantidade: voltaram, tom: "info", href: "/automacoes" });
    }, undefined),

    // promoções
    seguro(async () => {
      const pendentes = (await listDue(db, storeId)).length;
      add({ id: "promo-pendentes", titulo: `${plural(pendentes, "promoção pede", "promoções pedem")} ação agora`, detalhe: "Iniciar, encerrar ou continuar o que ficou pela metade.", quantidade: pendentes, tom: "danger", href: "/promocoes" });
      const [p] = await db.query<{ comecam: string; terminam: string }>(
        `SELECT count(*) FILTER (WHERE status = 'agendada' AND starts_at > now() AND starts_at <= now() + interval '24 hours')::text AS comecam,
                count(*) FILTER (WHERE status = 'ativa' AND ends_at > now() AND ends_at <= now() + interval '24 hours')::text AS terminam
         FROM promotions WHERE store_id = $1::uuid`,
        [storeId],
      );
      add({ id: "promo-comecam", titulo: `${plural(Number(p?.comecam ?? 0), "promoção começa", "promoções começam")} nas próximas 24 horas`, quantidade: Number(p?.comecam ?? 0), tom: "info", href: "/promocoes" });
      add({ id: "promo-terminam", titulo: `${plural(Number(p?.terminam ?? 0), "promoção termina", "promoções terminam")} nas próximas 24 horas`, quantidade: Number(p?.terminam ?? 0), tom: "info", href: "/promocoes" });
    }, undefined),

    // lotes
    seguro(async () => {
      const [l] = await db.query<{ andamento: string; com_erro: string }>(
        `SELECT (SELECT count(*) FROM bulk_jobs WHERE store_id = $1::uuid AND status = 'running')::text AS andamento,
                (SELECT count(DISTINCT j.id) FROM bulk_jobs j JOIN bulk_job_items i ON i.job_id = j.id
                  WHERE j.store_id = $1::uuid AND j.finished_at > now() - interval '3 days' AND i.status IN ('error', 'conflict'))::text AS com_erro`,
        [storeId],
      );
      add({ id: "lote-erro", titulo: `${plural(Number(l?.com_erro ?? 0), "lote terminou", "lotes terminaram")} com erros ou conflitos`, detalhe: "Nos últimos 3 dias.", quantidade: Number(l?.com_erro ?? 0), tom: "warning", href: "/lote" });
      add({ id: "lote-andamento", titulo: `${plural(Number(l?.andamento ?? 0), "lote em andamento", "lotes em andamento")}`, quantidade: Number(l?.andamento ?? 0), tom: "info", href: "/lote" });
    }, undefined),

    // cashback
    seguro(async () => {
      const semAviso = (await listarGrants(db, storeId, 200)).filter((g) => !g.cancelled_at && !g.contacted_at).length;
      add({ id: "cash-sem-aviso", titulo: `${plural(semAviso, "cupom de cashback ainda sem aviso", "cupons de cashback ainda sem aviso")} à cliente`, quantidade: semAviso, tom: "info", href: "/cashback" });
      if (temPedidos) {
        const podem = (await pedidosElegiveis(db, storeId, await obterConfig(db, storeId))).filter((p) => !p.retido).length;
        add({ id: "cash-elegiveis", titulo: `${plural(podem, "pedido pode", "pedidos podem")} ganhar cashback`, quantidade: podem, tom: "info", href: "/cashback" });
      }
    }, undefined),
  ]);

  tarefas.sort((a, b) => ORDEM[a.tom] - ORDEM[b.tom] || b.quantidade - a.quantidade || a.id.localeCompare(b.id));

  const vendas = temPedidos
    ? await seguro<VendasDoDia | null>(async () => {
        const hoje = hojeEmBrasilia(agora);
        const [h, o, sete] = await Promise.all([
          resumoDoPeriodo(db, storeId, { de: hoje, ate: hoje }),
          resumoDoPeriodo(db, storeId, { de: somarDias(hoje, -1), ate: somarDias(hoje, -1) }),
          resumoDoPeriodo(db, storeId, { de: somarDias(hoje, -7), ate: somarDias(hoje, -1) }),
        ]);
        return { hoje: h, ontem: o, mediaDiaria: Math.round((sete.faturamento / 7) * 100) / 100 };
      }, null)
    : null;

  return { tarefas, vendas, pedidosLidosEm, pedidosDesatualizados };
}
