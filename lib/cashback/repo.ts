import { sinaisDeRisco, PRECISA_CONFERIR } from "@/lib/risk/signals";
import type { Db } from "@/lib/sync/repo";
import { IDADE_MAXIMA_DIAS, INTERVALO_POR_CLIENTE_DIAS, PADRAO, valorDoCashback, type CashbackConfig } from "./rules";

export async function obterConfig(db: Db, storeId: string): Promise<CashbackConfig> {
  const r = await db.query<{ percent: string; min_order: string; min_purchase: string; max_value: string; valid_days: number; wait_days: number; month_budget: string }>(
    "SELECT percent::text, min_order::text, min_purchase::text, max_value::text, valid_days, wait_days, month_budget::text FROM cashback_settings WHERE store_id = $1::uuid",
    [storeId],
  );
  const x = r[0];
  if (!x) return { ...PADRAO };
  return { percent: Number(x.percent), minOrder: Number(x.min_order), minPurchase: Number(x.min_purchase), maxValue: Number(x.max_value), validDays: x.valid_days, waitDays: x.wait_days, monthBudget: Number(x.month_budget) };
}

export async function salvarConfig(db: Db, storeId: string, c: CashbackConfig, actor: string): Promise<void> {
  await db.query(
    `INSERT INTO cashback_settings (store_id, percent, min_order, min_purchase, max_value, valid_days, wait_days, month_budget, updated_at, updated_by)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, now(), $9)
     ON CONFLICT (store_id) DO UPDATE SET percent = $2, min_order = $3, min_purchase = $4, max_value = $5, valid_days = $6, wait_days = $7, month_budget = $8, updated_at = now(), updated_by = $9`,
    [storeId, c.percent, c.minOrder, c.minPurchase, c.maxValue, c.validDays, c.waitDays, c.monthBudget, actor],
  );
}

/** Soma dos cupons emitidos (e não cancelados) no mês corrente, no horário de Brasília. */
export async function gastoDoMes(db: Db, storeId: string): Promise<number> {
  const r = await db.query<{ total: string | null }>(
    `SELECT sum(value)::text AS total FROM cashback_grants
     WHERE store_id = $1::uuid AND cancelled_at IS NULL
       AND issued_at >= (date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')`,
    [storeId],
  );
  return Number(r[0]?.total ?? 0);
}

export interface PedidoElegivel {
  id: string;
  numero: number | null;
  criadoEm: string;
  total: number;
  valor: number;
  /** Sinais de risco (vazio = nenhum). */
  sinais: string[];
  /** Dois sinais ou mais: o painel não propõe cashback. */
  retido: boolean;
}

/**
 * Pedidos que podem ganhar cashback, do mais antigo ao mais novo: pagos e não cancelados, com cliente identificada, a partir do valor mínimo,
 * já passada a espera, dos últimos 60 dias, sem cupom e sem outro cupom (não cancelado) para a mesma cliente nos últimos 60 dias.
 * `ids` restringe a busca (usado ao emitir, para reavaliar no servidor). Pedidos com dois sinais de risco ou mais vêm marcados como retidos.
 */
export async function pedidosElegiveis(db: Db, storeId: string, c: CashbackConfig, ids?: string[]): Promise<PedidoElegivel[]> {
  const rows = await db.query<{ id: string; numero: number | null; criado_em: string; total: string }>(
    `SELECT o.id::text AS id, o.number AS numero, o.created_at_remote::text AS criado_em, o.total::text AS total
     FROM orders o
     WHERE o.store_id = $1::uuid
       AND o.payment_status = 'paid' AND coalesce(o.status, 'open') <> 'cancelled'
       AND o.customer_id IS NOT NULL AND o.total >= $2::numeric
       AND o.created_at_remote <= now() - make_interval(days => $3::int)
       AND o.created_at_remote >= now() - make_interval(days => $4::int)
       AND NOT EXISTS (SELECT 1 FROM cashback_grants g WHERE g.store_id = o.store_id AND g.order_id = o.id)
       AND NOT EXISTS (
         SELECT 1 FROM cashback_grants g JOIN orders o2 ON o2.store_id = g.store_id AND o2.id = g.order_id
         WHERE g.store_id = o.store_id AND g.cancelled_at IS NULL AND o2.customer_id = o.customer_id
           AND g.issued_at > now() - make_interval(days => $5::int))
       AND ($6::text[] IS NULL OR o.id::text = ANY($6::text[]))
     ORDER BY o.created_at_remote, o.id`,
    [storeId, c.minOrder, c.waitDays, IDADE_MAXIMA_DIAS, INTERVALO_POR_CLIENTE_DIAS, ids ?? null],
  );
  // dois pedidos da mesma cliente na lista: só o mais antigo pode receber agora
  const sinais = await sinaisDeRisco(db, storeId, rows.map((r) => r.id));
  const clientes = await db.query<{ id: string; cliente: string }>("SELECT id::text AS id, customer_id::text AS cliente FROM orders WHERE store_id = $1::uuid AND id::text = ANY($2::text[])", [storeId, rows.map((r) => r.id)]);
  const clienteDe = new Map(clientes.map((x) => [x.id, x.cliente]));
  const jaNaLista = new Set<string>();
  const out: PedidoElegivel[] = [];
  for (const r of rows) {
    const cli = clienteDe.get(r.id) ?? r.id;
    if (jaNaLista.has(cli)) continue;
    jaNaLista.add(cli);
    const s = sinais.get(r.id) ?? [];
    out.push({ id: r.id, numero: r.numero, criadoEm: r.criado_em, total: Number(r.total), valor: valorDoCashback(Number(r.total), c), sinais: s, retido: s.length >= PRECISA_CONFERIR });
  }
  return out;
}

export interface Grant {
  order_id: string;
  order_number: number | null;
  coupon_id: string | null;
  coupon_code: string;
  value: string;
  expires_on: string;
  issued_at: string;
  issued_by: string;
  contacted_at: string | null;
  cancelled_at: string | null;
}

export async function listarGrants(db: Db, storeId: string, limite = 100): Promise<Grant[]> {
  return db.query<Grant>(
    `SELECT order_id::text, order_number, coupon_id::text, coupon_code, value::text, expires_on::text, issued_at::text, issued_by, contacted_at::text, cancelled_at::text
     FROM cashback_grants WHERE store_id = $1::uuid ORDER BY issued_at DESC LIMIT ${Math.min(Math.max(limite, 1), 500)}`,
    [storeId],
  );
}
