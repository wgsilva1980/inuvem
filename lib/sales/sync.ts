import type { Order } from "@/lib/nuvemshop/orders";
import type { Db } from "@/lib/sync/repo";

export interface LinhaVenda {
  product_id: number;
  units: number;
  orders: number;
  last_sold_at: string | null;
}

/** Pedido que conta como venda: não cancelado e pago (ou sem a informação de pagamento). */
export const contaComoVenda = (o: Order): boolean => o.status !== "cancelled" && (o.payment_status == null || o.payment_status === "paid");

/** Soma, por produto, as unidades e os pedidos de uma página de pedidos (e a data da última venda). */
export function resumirPedidos(pedidos: Order[]): LinhaVenda[] {
  const por = new Map<number, LinhaVenda>();
  for (const o of pedidos) {
    if (!contaComoVenda(o)) continue;
    const quando = o.created_at && Number.isFinite(Date.parse(o.created_at)) ? new Date(o.created_at).toISOString() : null;
    const vistos = new Set<number>();
    for (const l of o.products ?? []) {
      const id = l.product_id;
      if (!id) continue;
      const q = Number(l.quantity);
      const unidades = Number.isFinite(q) && q > 0 ? Math.round(q) : 1;
      const r = por.get(id) ?? { product_id: id, units: 0, orders: 0, last_sold_at: null };
      r.units += unidades;
      if (!vistos.has(id)) r.orders += 1;
      vistos.add(id);
      if (quando && (r.last_sold_at === null || quando > r.last_sold_at)) r.last_sold_at = quando;
      por.set(id, r);
    }
  }
  return [...por.values()];
}

/**
 * Grava uma página de resumos na leitura `runId`: soma às linhas da mesma leitura e substitui as de leituras antigas. O marcador da página
 * vai na mesma instrução, então repetir uma página já gravada (resposta perdida) não conta duas vezes.
 */
export async function gravarVendas(db: Db, storeId: string, runId: string, page: number, linhas: LinhaVenda[]): Promise<boolean> {
  const [marca] = await db.query<{ run: string | null; pagina: number | null }>("SELECT sales_run_id::text AS run, sales_run_page AS pagina FROM store_settings WHERE store_id = $1::uuid", [storeId]);
  if (marca?.run === runId && marca.pagina !== null && marca.pagina >= page) return false;
  await db.query(
    `WITH rec AS (SELECT * FROM jsonb_to_recordset($3::jsonb) AS m(product_id bigint, units int, orders int, last_sold_at timestamptz)),
     up AS (
       INSERT INTO product_sales (store_id, product_id, units, orders, last_sold_at, run_id)
       SELECT $1::uuid, product_id, units, orders, last_sold_at, $2::uuid FROM rec
       ON CONFLICT (store_id, product_id) DO UPDATE SET
         units = CASE WHEN product_sales.run_id = EXCLUDED.run_id THEN product_sales.units + EXCLUDED.units ELSE EXCLUDED.units END,
         orders = CASE WHEN product_sales.run_id = EXCLUDED.run_id THEN product_sales.orders + EXCLUDED.orders ELSE EXCLUDED.orders END,
         last_sold_at = CASE WHEN product_sales.run_id = EXCLUDED.run_id THEN greatest(product_sales.last_sold_at, EXCLUDED.last_sold_at) ELSE EXCLUDED.last_sold_at END,
         run_id = EXCLUDED.run_id
       RETURNING 1)
     INSERT INTO store_settings (store_id, sales_run_id, sales_run_page) VALUES ($1::uuid, $2::uuid, $4)
     ON CONFLICT (store_id) DO UPDATE SET sales_run_id = EXCLUDED.sales_run_id, sales_run_page = EXCLUDED.sales_run_page`,
    [storeId, runId, JSON.stringify(linhas), page],
  );
  return true;
}

export interface ResumoVendas {
  sincronizadoEm: string | null;
  janelaDias: number | null;
}

export async function resumoVendas(db: Db, storeId: string): Promise<ResumoVendas> {
  const [r] = await db.query<{ quando: string | null; dias: number | null }>("SELECT sales_synced_at::text AS quando, sales_window_days AS dias FROM store_settings WHERE store_id = $1::uuid", [storeId]);
  return { sincronizadoEm: r?.quando ?? null, janelaDias: r?.dias ?? null };
}

export interface FontePedidos {
  listPage(page: number, desde: string): Promise<{ items: Order[]; nextPage: number | null; invalidos: number; campos: string[] }>;
}

export interface PassoVendas {
  proxima: number | null;
  concluido: boolean;
  runId: string;
  lidos: number;
  invalidos: number;
  campos: string[];
  produtos: number;
}

export const JANELA_PADRAO_DIAS = 365;
const UUID = /^[0-9a-f-]{36}$/i;

/** Lê pedidos pagos da janela, página a página, até acabar o tempo (a tela repete com `proxima` e o mesmo `runId`). No fim, remove o que sobrou de leituras antigas. */
export async function passoVendas(
  db: Db,
  fonte: FontePedidos,
  args: { storeId: string; page?: number; runId?: string; janelaDias?: number; budgetMs: number; now?: () => number; novoId?: () => string },
): Promise<PassoVendas> {
  const now = args.now ?? Date.now;
  const comeco = now();
  const dias = Math.min(Math.max(Math.round(args.janelaDias ?? JANELA_PADRAO_DIAS), 30), 730);
  const runId = args.runId && UUID.test(args.runId) ? args.runId : (args.novoId ?? (() => crypto.randomUUID()))();
  const desde = new Date(comeco - dias * 86_400_000).toISOString();
  const out: PassoVendas = { proxima: args.page ?? 1, concluido: false, runId, lidos: 0, invalidos: 0, campos: [], produtos: 0 };
  const campos = new Set<string>();
  let page = args.page ?? 1;
  while (true) {
    const r = await fonte.listPage(page, desde);
    out.lidos += r.items.length;
    out.invalidos += r.invalidos;
    for (const c of r.campos) campos.add(c);
    const linhas = resumirPedidos(r.items);
    out.produtos += linhas.length;
    await gravarVendas(db, args.storeId, runId, page, linhas);
    if (r.nextPage === null) {
      await db.query("DELETE FROM product_sales WHERE store_id = $1::uuid AND run_id <> $2::uuid", [args.storeId, runId]);
      await db.query(
        `INSERT INTO store_settings (store_id, sales_synced_at, sales_window_days) VALUES ($1::uuid, now(), $2)
         ON CONFLICT (store_id) DO UPDATE SET sales_synced_at = EXCLUDED.sales_synced_at, sales_window_days = EXCLUDED.sales_window_days`,
        [args.storeId, dias],
      );
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
