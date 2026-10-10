import type { Order } from "@/lib/nuvemshop/orders";
import type { Db } from "@/lib/sync/repo";
import { mapearPedido, type ItemMapeado, type PedidoMapeado } from "./map";

/** Pedido que conta como venda: pago e não cancelado. */
export const SQL_VENDA = "(o.payment_status = 'paid' AND coalesce(o.status, '') <> 'cancelled')";

export const JANELA_PADRAO_DIAS = 365;
/** Margem para pegar pedidos alterados enquanto a sincronização anterior rodava. */
const MARGEM_MS = 10 * 60 * 1000;

export interface ResultadoPagina {
  novos: number;
  atualizados: number;
  itens: number;
}

/** Grava uma página de pedidos: o pedido é substituído e as linhas dele são refeitas (3 consultas por página, não uma por pedido). */
export async function gravarPedidos(db: Db, storeId: string, mapeados: Array<{ pedido: PedidoMapeado; itens: ItemMapeado[] }>): Promise<ResultadoPagina> {
  if (mapeados.length === 0) return { novos: 0, atualizados: 0, itens: 0 };
  const pedidos = mapeados.map((m) => m.pedido);
  const itens = mapeados.flatMap((m) => m.itens);
  const ids = pedidos.map((p) => p.id);

  const gravados = await db.query<{ novo: boolean }>(
    `INSERT INTO orders (store_id, id, number, created_at_remote, total, discount, status, payment_status, shipping_status, tracking_code, customer_id, updated_at_remote, synced_at)
     SELECT $1::uuid, m.id, m.number, m.created_at_remote, m.total, m.discount, m.status, m.payment_status, m.shipping_status, m.tracking_code, m.customer_id, m.updated_at_remote, now()
     FROM jsonb_to_recordset($2::jsonb) AS m(id bigint, number int, created_at_remote timestamptz, total numeric, discount numeric, status text, payment_status text, shipping_status text, tracking_code text, customer_id bigint, updated_at_remote timestamptz)
     ON CONFLICT (store_id, id) DO UPDATE SET number = EXCLUDED.number, created_at_remote = EXCLUDED.created_at_remote, total = EXCLUDED.total, discount = EXCLUDED.discount,
       status = EXCLUDED.status, payment_status = EXCLUDED.payment_status, shipping_status = EXCLUDED.shipping_status,
       tracking_code = coalesce(EXCLUDED.tracking_code, orders.tracking_code),
       customer_id = coalesce(EXCLUDED.customer_id, orders.customer_id), updated_at_remote = EXCLUDED.updated_at_remote, synced_at = now()
     RETURNING (xmax = 0) AS novo`,
    [storeId, JSON.stringify(pedidos)],
  );
  await db.query("DELETE FROM order_items WHERE store_id = $1::uuid AND order_id = ANY($2::bigint[])", [storeId, ids]);
  if (itens.length > 0) {
    await db.query(
      `INSERT INTO order_items (store_id, order_id, seq, product_id, variant_id, name, quantity, unit_price, variant_values)
       SELECT $1::uuid, m.order_id, m.seq, m.product_id, m.variant_id, m.name, m.quantity, m.unit_price, m.variant_values
       FROM jsonb_to_recordset($2::jsonb) AS m(order_id bigint, seq int, product_id bigint, variant_id bigint, name text, quantity int, unit_price numeric, variant_values jsonb)`,
      [storeId, JSON.stringify(itens)],
    );
  }
  return { novos: gravados.filter((r) => r.novo).length, atualizados: gravados.filter((r) => !r.novo).length, itens: itens.length };
}

export async function ultimaSincronizacaoPedidos(db: Db, storeId: string): Promise<string | null> {
  const [r] = await db.query<{ quando: string | null }>("SELECT orders_synced_at::text AS quando FROM store_settings WHERE store_id = $1::uuid", [storeId]);
  return r?.quando ?? null;
}

/**
 * Refaz o resumo por produto (`product_sales`, usado na liquidação) a partir do espelho: unidades, pedidos e última venda dos pedidos pagos
 * da janela. Primeiro grava/atualiza e só depois remove os que não vendem mais, então a tabela nunca fica vazia no meio.
 */
export async function reconstruirVendas(db: Db, storeId: string, janelaDias = JANELA_PADRAO_DIAS): Promise<number> {
  const [run] = await db.query<{ id: string }>("SELECT gen_random_uuid()::text AS id");
  const rows = await db.query<{ product_id: string }>(
    `INSERT INTO product_sales (store_id, product_id, units, orders, last_sold_at, run_id)
     SELECT $1::uuid, i.product_id, sum(i.quantity)::int, count(DISTINCT i.order_id)::int, max(o.created_at_remote), $2::uuid
     FROM order_items i JOIN orders o ON o.store_id = i.store_id AND o.id = i.order_id
     WHERE i.store_id = $1::uuid AND i.product_id IS NOT NULL AND ${SQL_VENDA} AND o.created_at_remote >= now() - make_interval(days => $3::int)
     GROUP BY i.product_id
     ON CONFLICT (store_id, product_id) DO UPDATE SET units = EXCLUDED.units, orders = EXCLUDED.orders, last_sold_at = EXCLUDED.last_sold_at, run_id = EXCLUDED.run_id
     RETURNING product_id::text`,
    [storeId, run!.id, janelaDias],
  );
  await db.query("DELETE FROM product_sales WHERE store_id = $1::uuid AND run_id <> $2::uuid", [storeId, run!.id]);
  await db.query(
    `INSERT INTO store_settings (store_id, sales_synced_at, sales_window_days) VALUES ($1::uuid, now(), $2)
     ON CONFLICT (store_id) DO UPDATE SET sales_synced_at = EXCLUDED.sales_synced_at, sales_window_days = EXCLUDED.sales_window_days`,
    [storeId, janelaDias],
  );
  return rows.length;
}

export interface FontePedidos {
  listPage(page: number, filtro: { criadosDesde?: string; atualizadosDesde?: string }): Promise<{ items: Order[]; nextPage: number | null; invalidos: number; campos: string[] }>;
}

export interface PassoPedidos extends ResultadoPagina {
  proxima: number | null;
  concluido: boolean;
  lidos: number;
  invalidos: number;
  /** Nomes dos campos que a API devolveu (sem valores). */
  campos: string[];
  /** Pedidos sem data de criação válida, que não entraram. */
  ignorados: number;
  /** Instante em que a sincronização começou: a tela devolve nos passos seguintes. */
  inicio: string;
  incremental: boolean;
}

/**
 * Sincroniza pedidos até acabar o tempo (a tela repete com `proxima`). A primeira vez (ou `completo`) lê os pedidos criados na janela; depois
 * lê só os alterados desde a última vez (assim um pedido que foi cancelado ou reembolsado é atualizado). Ao terminar, guarda o instante do início
 * e refaz o resumo por produto.
 */
export async function passoPedidos(
  db: Db,
  fonte: FontePedidos,
  args: { storeId: string; page?: number; completo?: boolean; inicio?: string; janelaDias?: number; budgetMs: number; now?: () => number },
): Promise<PassoPedidos> {
  const now = args.now ?? Date.now;
  const comeco = now();
  const dias = Math.min(Math.max(Math.round(args.janelaDias ?? JANELA_PADRAO_DIAS), 30), 730);
  const inicio = args.inicio ?? new Date(comeco).toISOString();
  const anterior = args.completo ? null : await ultimaSincronizacaoPedidos(db, args.storeId);
  const filtro = anterior
    ? { atualizadosDesde: new Date(new Date(anterior).getTime() - MARGEM_MS).toISOString() }
    : { criadosDesde: new Date(comeco - dias * 86_400_000).toISOString() };
  const out: PassoPedidos = { proxima: args.page ?? 1, concluido: false, lidos: 0, invalidos: 0, campos: [], ignorados: 0, inicio, incremental: anterior !== null, novos: 0, atualizados: 0, itens: 0 };
  const campos = new Set<string>();
  let page = args.page ?? 1;
  while (true) {
    const r = await fonte.listPage(page, filtro);
    out.lidos += r.items.length;
    out.invalidos += r.invalidos;
    for (const c of r.campos) campos.add(c);
    const mapeados = r.items.map(mapearPedido).filter((m): m is NonNullable<typeof m> => m !== null);
    out.ignorados += r.items.length - mapeados.length;
    const g = await gravarPedidos(db, args.storeId, mapeados);
    out.novos += g.novos;
    out.atualizados += g.atualizados;
    out.itens += g.itens;
    if (r.nextPage === null) {
      await db.query(
        `INSERT INTO store_settings (store_id, orders_synced_at) VALUES ($1::uuid, $2::timestamptz)
         ON CONFLICT (store_id) DO UPDATE SET orders_synced_at = EXCLUDED.orders_synced_at`,
        [args.storeId, inicio],
      );
      await reconstruirVendas(db, args.storeId, dias);
      out.proxima = null;
      out.concluido = true;
      break;
    }
    page = r.nextPage;
    out.proxima = page;
    if (now() - comeco >= args.budgetMs) break;
  }
  out.campos = [...campos].sort();
  return out;
}
