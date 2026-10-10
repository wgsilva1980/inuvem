import type { Db } from "@/lib/sync/repo";
import { ESPERA_APOS_AVISO_DIAS, JANELA_RESULTADO_DIAS, MAX_LISTA } from "./rules";

export interface ClienteInativa {
  id: string;
  nome: string;
  cidade: string | null;
  uf: string | null;
  ultimaCompra: string;
  diasSemComprar: number;
  pedidos: number;
  totalGasto: number;
  aceitaMarketing: boolean | null;
  temWhatsapp: boolean;
  temEmail: boolean;
}

/**
 * Clientes que já compraram (pedido pago e não cancelado) e não voltam há mais de `dias` dias, das que mais gastaram para as que menos.
 * Fora da lista: quem recusou receber contato (`accepts_marketing = false`), quem foi avisada nos últimos 30 dias e quem foi ignorada em Contatos.
 */
export async function clientesInativas(db: Db, storeId: string, dias: number): Promise<ClienteInativa[]> {
  const rows = await db.query<{ id: string; nome: string | null; cidade: string | null; uf: string | null; ultima: string; dias: number; pedidos: string; gasto: string; marketing: boolean | null; tem_fone: boolean; tem_email: boolean }>(
    `WITH base AS (
       SELECT o.customer_id, max(o.created_at_remote) AS ultima, count(*) AS pedidos, sum(o.total) AS gasto
       FROM orders o
       WHERE o.store_id = $1::uuid AND o.customer_id IS NOT NULL AND o.payment_status = 'paid' AND coalesce(o.status, 'open') <> 'cancelled'
       GROUP BY o.customer_id
     )
     SELECT b.customer_id::text AS id, c.name AS nome, c.city AS cidade, c.state AS uf, b.ultima::text AS ultima,
            floor(extract(epoch FROM (now() - b.ultima)) / 86400)::int AS dias, b.pedidos::text AS pedidos, b.gasto::text AS gasto,
            c.accepts_marketing AS marketing, (nullif(c.phone, '') IS NOT NULL) AS tem_fone, (nullif(c.email, '') IS NOT NULL) AS tem_email
     FROM base b
     LEFT JOIN customers c ON c.store_id = $1::uuid AND c.id = b.customer_id
     WHERE b.ultima < now() - make_interval(days => $2::int)
       AND coalesce(c.accepts_marketing, true) = true AND coalesce(c.ignored, false) = false
       AND NOT EXISTS (SELECT 1 FROM reactivation_contacts r WHERE r.store_id = $1::uuid AND r.customer_id = b.customer_id AND r.contacted_at > now() - make_interval(days => $3::int))
     ORDER BY b.gasto DESC, b.customer_id
     LIMIT ${MAX_LISTA}`,
    [storeId, dias, ESPERA_APOS_AVISO_DIAS],
  );
  return rows.map((r) => ({
    id: r.id,
    nome: r.nome ?? `Cliente ${r.id}`,
    cidade: r.cidade,
    uf: r.uf,
    ultimaCompra: r.ultima,
    diasSemComprar: r.dias,
    pedidos: Number(r.pedidos),
    totalGasto: Number(r.gasto),
    aceitaMarketing: r.marketing,
    temWhatsapp: r.tem_fone,
    temEmail: r.tem_email,
  }));
}

/** Quantas clientes estão na faixa (sem o limite da lista), para o total. */
export async function contarInativas(db: Db, storeId: string, dias: number): Promise<number> {
  const [r] = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM (
       SELECT o.customer_id, max(o.created_at_remote) AS ultima
       FROM orders o
       WHERE o.store_id = $1::uuid AND o.customer_id IS NOT NULL AND o.payment_status = 'paid' AND coalesce(o.status, 'open') <> 'cancelled'
       GROUP BY o.customer_id
     ) b
     LEFT JOIN customers c ON c.store_id = $1::uuid AND c.id = b.customer_id
     WHERE b.ultima < now() - make_interval(days => $2::int)
       AND coalesce(c.accepts_marketing, true) = true AND coalesce(c.ignored, false) = false
       AND NOT EXISTS (SELECT 1 FROM reactivation_contacts r WHERE r.store_id = $1::uuid AND r.customer_id = b.customer_id AND r.contacted_at > now() - make_interval(days => $3::int))`,
    [storeId, dias, ESPERA_APOS_AVISO_DIAS],
  );
  return Number(r?.n ?? 0);
}

export async function marcarAvisada(db: Db, storeId: string, customerId: string, actor: string): Promise<void> {
  await db.query(
    `INSERT INTO reactivation_contacts (store_id, customer_id, contacted_at, contacted_by) VALUES ($1::uuid, $2::bigint, now(), $3)
     ON CONFLICT (store_id, customer_id) DO UPDATE SET contacted_at = now(), contacted_by = $3`,
    [storeId, customerId, actor],
  );
}

export interface ResultadoReativacao {
  avisadas: number;
  voltaram: number;
  faturamento: number;
}

/** Das avisadas nos últimos 90 dias, quantas fizeram um pedido pago depois do aviso (e quanto renderam). Medida simples, não prova que o aviso causou a compra. */
export async function resultadoDaReativacao(db: Db, storeId: string): Promise<ResultadoReativacao> {
  const [r] = await db.query<{ avisadas: string; voltaram: string; faturamento: string | null }>(
    `SELECT count(DISTINCT r.customer_id)::text AS avisadas,
            count(DISTINCT r.customer_id) FILTER (WHERE o.id IS NOT NULL)::text AS voltaram,
            sum(o.total)::text AS faturamento
     FROM reactivation_contacts r
     LEFT JOIN orders o ON o.store_id = r.store_id AND o.customer_id = r.customer_id AND o.created_at_remote > r.contacted_at
          AND o.payment_status = 'paid' AND coalesce(o.status, 'open') <> 'cancelled'
     WHERE r.store_id = $1::uuid AND r.contacted_at > now() - make_interval(days => $2::int)`,
    [storeId, JANELA_RESULTADO_DIAS],
  );
  return { avisadas: Number(r?.avisadas ?? 0), voltaram: Number(r?.voltaram ?? 0), faturamento: Number(r?.faturamento ?? 0) };
}
