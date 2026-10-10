import type { Db } from "@/lib/sync/repo";

export type StatusPedido = "aberto" | "recebido" | "cancelado";

export interface ItemPedido {
  seq: number;
  productId: string;
  variantId: string;
  produto: string;
  variacao: string;
  sku: string | null;
  qty: number;
  custo: number | null;
  recebido: boolean;
}

export interface PedidoCompra {
  id: string;
  fornecedor: string;
  previsto: string | null;
  observacao: string | null;
  status: StatusPedido;
  estoqueAtualizado: boolean;
  criadoEm: string;
  criadoPor: string | null;
  fechadoEm: string | null;
  itens: ItemPedido[];
  /** Soma de quantidade × custo das linhas que têm custo. */
  total: number;
  semCusto: number;
}

/** Unidades a caminho por variação (pedidos abertos, sem contar linhas que já foram somadas ao estoque). */
export async function aCaminhoPorVariacao(db: Db, storeId: string): Promise<Map<string, number>> {
  const rows = await db.query<{ variant_id: string; n: string }>(
    `SELECT i.variant_id::text AS variant_id, sum(i.qty)::text AS n
     FROM purchase_order_items i JOIN purchase_orders p ON p.id = i.order_id
     WHERE p.store_id = $1::uuid AND p.status = 'aberto' AND i.received_at IS NULL GROUP BY i.variant_id`,
    [storeId],
  );
  return new Map(rows.map((r) => [r.variant_id, Number(r.n)]));
}

interface LinhaPedido {
  id: string; supplier: string; expected_on: string | null; note: string | null; status: StatusPedido; stock_updated: boolean; created_at: string; created_by: string | null; closed_at: string | null;
}
interface LinhaItem {
  order_id: string; seq: number; product_id: string; variant_id: string; product_name: string; variation: string; sku: string | null; qty: number; unit_cost: string | null; received_at: string | null;
}

function montar(p: LinhaPedido, itens: LinhaItem[]): PedidoCompra {
  const its: ItemPedido[] = itens.map((i) => ({ seq: i.seq, productId: i.product_id, variantId: i.variant_id, produto: i.product_name, variacao: i.variation, sku: i.sku, qty: i.qty, custo: i.unit_cost === null ? null : Number(i.unit_cost), recebido: i.received_at !== null }));
  return {
    id: p.id, fornecedor: p.supplier, previsto: p.expected_on, observacao: p.note, status: p.status, estoqueAtualizado: p.stock_updated, criadoEm: p.created_at, criadoPor: p.created_by, fechadoEm: p.closed_at,
    itens: its,
    total: Math.round(its.reduce((s, i) => s + (i.custo === null ? 0 : i.custo * i.qty), 0) * 100) / 100,
    semCusto: its.filter((i) => i.custo === null).length,
  };
}

const COLS_PEDIDO = "id::text, supplier, expected_on::text, note, status, stock_updated, created_at::text, created_by, closed_at::text";
const COLS_ITEM = "order_id::text, seq, product_id::text, variant_id::text, product_name, variation, sku, qty, unit_cost::text, received_at::text";

/** Pedidos da loja, os abertos primeiro (previsão mais próxima antes), depois os mais recentes. */
export async function listarPedidos(db: Db, storeId: string, limite = 100): Promise<PedidoCompra[]> {
  const pedidos = await db.query<LinhaPedido>(
    `SELECT ${COLS_PEDIDO} FROM purchase_orders WHERE store_id = $1::uuid
     ORDER BY (status = 'aberto') DESC, CASE WHEN status = 'aberto' THEN coalesce(expected_on, '9999-12-31'::date) END, created_at DESC LIMIT ${limite}`,
    [storeId],
  );
  if (pedidos.length === 0) return [];
  const itens = await db.query<LinhaItem>(`SELECT ${COLS_ITEM} FROM purchase_order_items WHERE order_id = ANY($1::bigint[]) ORDER BY order_id, seq`, [pedidos.map((p) => p.id)]);
  return pedidos.map((p) => montar(p, itens.filter((i) => i.order_id === p.id)));
}

export async function obterPedido(db: Db, storeId: string, id: string): Promise<PedidoCompra | null> {
  const [p] = await db.query<LinhaPedido>(`SELECT ${COLS_PEDIDO} FROM purchase_orders WHERE store_id = $1::uuid AND id = $2::bigint`, [storeId, id]);
  if (!p) return null;
  const itens = await db.query<LinhaItem>(`SELECT ${COLS_ITEM} FROM purchase_order_items WHERE order_id = $1::bigint ORDER BY seq`, [id]);
  return montar(p, itens);
}
