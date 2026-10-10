import type { Db } from "@/lib/sync/repo";

/**
 * Sinais para CONFERIR um pedido antes de enviar. Não é antifraude de verdade (o painel não vê pagamento, IP nem endereço): são regras simples
 * e explicáveis, sobre o espelho de pedidos, que apontam o que merece uma olhada. Nunca cancelam nada sozinhas.
 */
export const LIMITES = {
  /** Primeira compra com valor a partir de N vezes o ticket mediano da loja. */
  vezesMediana: 3,
  /** Só calcula a mediana com pelo menos N pedidos pagos nos últimos 365 dias. */
  minPedidosParaMediana: 20,
  /** N pedidos ou mais da mesma cliente em 24 horas. */
  pedidosEm24h: 3,
  /** Desconto a partir de N% do valor sem desconto. */
  descontoPercent: 50,
  /** N unidades ou mais da mesma peça (variação) no pedido. */
  unidadesIguais: 5,
} as const;

export interface ContextoRisco {
  /** Ticket mediano da loja (null se há poucos pedidos). */
  mediana: number | null;
  /** Pedidos pagos da mesma cliente antes deste. */
  anteriores: number;
  /** Pedidos da mesma cliente num intervalo de 24 h ao redor deste (inclui ele). */
  em24h: number;
}

export interface PedidoParaRisco {
  total: number;
  desconto: number;
  clienteConhecida: boolean;
  /** Maior quantidade de uma mesma variação no pedido. */
  maiorQuantidade: number;
}

const reais = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Os sinais de um pedido, em português. Lista vazia = nada a destacar. */
export function sinaisDoPedido(p: PedidoParaRisco, ctx: ContextoRisco): string[] {
  const out: string[] = [];
  if (p.clienteConhecida && ctx.mediana !== null && ctx.anteriores === 0 && p.total >= ctx.mediana * LIMITES.vezesMediana) {
    out.push(`Primeira compra de valor alto (${reais(p.total)}, o ticket mediano é ${reais(ctx.mediana)})`);
  }
  if (p.clienteConhecida && ctx.em24h >= LIMITES.pedidosEm24h) out.push(`${ctx.em24h} pedidos da mesma cliente em 24 horas`);
  const cheio = p.total + p.desconto;
  if (p.desconto > 0 && cheio > 0 && (p.desconto / cheio) * 100 >= LIMITES.descontoPercent) out.push(`Desconto de ${Math.round((p.desconto / cheio) * 100)}% do valor`);
  if (p.maiorQuantidade >= LIMITES.unidadesIguais) out.push(`${p.maiorQuantidade} unidades da mesma peça`);
  return out;
}

/** Dois sinais ou mais: vale conferir antes de enviar ou de dar cashback. */
export const PRECISA_CONFERIR = 2;

interface Linha {
  id: string;
  total: string;
  desconto: string;
  cliente: string | null;
  maior_qtd: string | null;
  anteriores: string;
  em24h: string;
}

/** Sinais de risco por pedido (chave = ID do pedido). Só pedidos com algum sinal entram no mapa. */
export async function sinaisDeRisco(db: Db, storeId: string, ids: string[]): Promise<Map<string, string[]>> {
  if (ids.length === 0) return new Map();
  const med = await db.query<{ n: string; mediana: string | null }>(
    `SELECT count(*)::text AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY total)::text AS mediana
     FROM orders WHERE store_id = $1::uuid AND payment_status = 'paid' AND created_at_remote >= now() - interval '365 days'`,
    [storeId],
  );
  const mediana = Number(med[0]?.n ?? 0) >= LIMITES.minPedidosParaMediana && med[0]?.mediana ? Number(med[0].mediana) : null;
  const rows = await db.query<Linha>(
    `SELECT o.id::text AS id, o.total::text AS total, o.discount::text AS desconto, o.customer_id::text AS cliente,
            (SELECT max(q) FROM (SELECT sum(i.quantity) AS q FROM order_items i WHERE i.store_id = o.store_id AND i.order_id = o.id GROUP BY coalesce(i.variant_id, i.product_id, i.seq)) x)::text AS maior_qtd,
            CASE WHEN o.customer_id IS NULL THEN '0' ELSE (SELECT count(*) FROM orders p WHERE p.store_id = o.store_id AND p.customer_id = o.customer_id AND p.id <> o.id AND p.payment_status = 'paid' AND p.created_at_remote < o.created_at_remote)::text END AS anteriores,
            CASE WHEN o.customer_id IS NULL THEN '1' ELSE (SELECT count(*) FROM orders p WHERE p.store_id = o.store_id AND p.customer_id = o.customer_id AND abs(extract(epoch FROM p.created_at_remote - o.created_at_remote)) <= 86400)::text END AS em24h
     FROM orders o WHERE o.store_id = $1::uuid AND o.id::text = ANY($2::text[])`,
    [storeId, ids],
  );
  const out = new Map<string, string[]>();
  for (const r of rows) {
    const s = sinaisDoPedido(
      { total: Number(r.total), desconto: Number(r.desconto), clienteConhecida: r.cliente !== null, maiorQuantidade: Number(r.maior_qtd ?? 0) },
      { mediana, anteriores: Number(r.anteriores), em24h: Number(r.em24h) },
    );
    if (s.length > 0) out.set(r.id, s);
  }
  return out;
}
