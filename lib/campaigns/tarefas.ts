import { proximasCampanhas, type CampanhaPrevista } from "@/lib/campaigns/calendario";
import type { Tarefa } from "@/lib/dashboard/hoje";
import type { Db } from "@/lib/sync/repo";

/** Só as datas de venda alta e média viram tarefa; as de venda baixa ficam só no calendário. */
const RELEVANTES = new Set(["alta", "media"]);
/** Aviso antecipado: quantos dias antes do prazo ideal de compra a campanha aparece como “para saber”. */
export const AVISO_ANTES_DA_COMPRA_DIAS = 14;
/** No máximo estas campanhas por vez no painel (as mais próximas). */
export const MAX_CAMPANHAS = 2;
/** Um pedido de compra feito a partir de tantos dias antes do prazo ideal conta como “já encomendei para esta campanha”. */
const FOLGA_PEDIDO_DIAS = 14;

const dia = (iso: string) => iso.split("-").reverse().join("/");
const em = (n: number) => (n === 0 ? "hoje" : n === 1 ? "amanhã" : `em ${n} dias`);

async function temPedidoDeCompra(db: Db, storeId: string, desde: string): Promise<boolean> {
  const [r] = await db.query<{ n: string }>("SELECT count(*)::text AS n FROM purchase_orders WHERE store_id = $1::uuid AND status <> 'cancelado' AND created_at >= $2::date", [storeId, desde]);
  return Number(r?.n ?? 0) > 0;
}

async function temPromocao(db: Db, storeId: string, c: CampanhaPrevista): Promise<boolean> {
  const [r] = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM promotions WHERE store_id = $1::uuid AND status IN ('agendada', 'aplicando', 'ativa')
       AND starts_at < ($3::date + 1) AND ends_at >= $2::date`,
    [storeId, c.inicioVendas, c.data],
  );
  return Number(r?.n ?? 0) > 0;
}

/**
 * As campanhas que pedem ação no painel do dia, sem repetir o que já foi feito: “encomendar” some quando há um pedido de compra criado perto do prazo
 * ideal, “montar a promoção” some quando já há uma promoção agendada ou ativa na janela da campanha. Só as de venda alta e média, as 2 mais próximas.
 */
export async function tarefasDeCampanhas(db: Db, storeId: string, hoje: string): Promise<Tarefa[]> {
  const tarefas: Tarefa[] = [];
  for (const c of proximasCampanhas(hoje, 120).filter((x) => RELEVANTES.has(x.relevancia))) {
    if (tarefas.length >= MAX_CAMPANHAS) break;
    const base = { id: `camp-${c.id}`, quantidade: 1 };
    if (c.fase === "futura") {
      const antes = Math.round((Date.parse(`${c.prazoCompra}T00:00:00Z`) - Date.parse(`${hoje}T00:00:00Z`)) / 86_400_000);
      if (antes <= AVISO_ANTES_DA_COMPRA_DIAS) tarefas.push({ ...base, titulo: `${c.nome} ${em(c.dias)}: o ideal é encomendar a mercadoria até ${dia(c.prazoCompra)}`, tom: "info", href: `/compras?prazo=${c.prazoCompras}&cobertura=30` });
    } else if (c.fase === "comprar") {
      const desde = new Date(Date.parse(`${c.prazoCompra}T00:00:00Z`) - FOLGA_PEDIDO_DIAS * 86_400_000).toISOString().slice(0, 10);
      if (!(await temPedidoDeCompra(db, storeId, desde))) tarefas.push({ ...base, titulo: `${c.nome} ${em(c.dias)}: hora de encomendar a mercadoria`, detalhe: `O ideal era até ${dia(c.prazoCompra)}. Some quando houver um pedido de compra.`, tom: "warning", href: `/compras?prazo=${c.prazoCompras}&cobertura=30` });
    } else if (c.fase === "preparar") {
      if (!(await temPromocao(db, storeId, c))) tarefas.push({ ...base, titulo: `${c.nome} ${em(c.dias)}: monte a promoção`, detalhe: `As vendas começam em ${dia(c.inicioVendas)}. Some quando houver uma promoção agendada.`, tom: "warning", href: "/promocoes" });
    } else {
      tarefas.push({ ...base, titulo: c.dias === 0 ? `${c.nome} é hoje` : `${c.nome} em andamento: termina ${em(c.dias)}`, tom: "info", href: "/campanhas" });
    }
  }
  return tarefas;
}
