import { ACAO_ENVIAR } from "@/lib/shipping/enviar";
import { JA_ENVIADO } from "@/lib/shipping/queue";
import type { Db } from "@/lib/sync/repo";
import { ESPERA_APOS_AVISO_DIAS, JANELA_MAXIMA_DIAS, JANELA_RESULTADO_DIAS, MAX_LISTA } from "./rules";

export interface PedidoPosVenda {
  orderId: string;
  numero: number | null;
  customerId: string;
  nome: string;
  cidade: string | null;
  uf: string | null;
  total: number;
  enviadoEm: string;
  diasDesdeEnvio: number;
  temWhatsapp: boolean;
  temEmail: boolean;
}

const ENVIADOS = JA_ENVIADO.map((s) => `'${s}'`).join(", ");

/**
 * O pedido foi enviado quando o painel marcou o envio (Histórico), ou, para os enviados direto no admin da Nuvemshop, na última atualização do
 * pedido. É uma aproximação: a Nuvemshop não diz o dia da entrega, só que o pedido foi despachado.
 */
const SQL_ENVIADO_EM = `coalesce(
  (SELECT max(a.created_at) FROM audit_log a WHERE a.store_id = o.store_id AND a.acao = '${ACAO_ENVIAR}' AND a.entidade_id = o.id::text AND a.sucesso),
  o.updated_at_remote, o.created_at_remote)`;

/** Pedidos pagos, não cancelados e já enviados há pelo menos `dias` dias (e no máximo 45), um por cliente (o mais recente), das compras maiores para as menores. */
const BASE = `
  FROM orders o
  LEFT JOIN customers c ON c.store_id = o.store_id AND c.id = o.customer_id
  CROSS JOIN LATERAL (SELECT ${SQL_ENVIADO_EM} AS enviado_em) e
  WHERE o.store_id = $1::uuid AND o.customer_id IS NOT NULL AND o.payment_status = 'paid' AND coalesce(o.status, 'open') <> 'cancelled'
    AND coalesce(o.shipping_status, '') IN (${ENVIADOS})
    AND e.enviado_em <= now() - make_interval(days => $2::int) AND e.enviado_em > now() - make_interval(days => ${JANELA_MAXIMA_DIAS})
    AND coalesce(c.accepts_marketing, true) = true AND coalesce(c.ignored, false) = false
    AND NOT EXISTS (SELECT 1 FROM postsale_contacts p WHERE p.store_id = o.store_id AND p.customer_id = o.customer_id AND p.contacted_at > now() - make_interval(days => $3::int))
    AND NOT EXISTS (SELECT 1 FROM orders mais WHERE mais.store_id = o.store_id AND mais.customer_id = o.customer_id AND mais.id <> o.id AND mais.created_at_remote > o.created_at_remote AND mais.payment_status = 'paid')`;

export async function pedidosParaPosVenda(db: Db, storeId: string, dias: number): Promise<PedidoPosVenda[]> {
  const rows = await db.query<{ id: string; numero: number | null; customer_id: string; nome: string | null; cidade: string | null; uf: string | null; total: string; enviado_em: string; dias: number; tem_fone: boolean; tem_email: boolean }>(
    `SELECT * FROM (
       SELECT DISTINCT ON (o.customer_id) o.id::text AS id, o.number AS numero, o.customer_id::text AS customer_id, c.name AS nome, c.city AS cidade, c.state AS uf, o.total::text AS total,
              e.enviado_em::text AS enviado_em, floor(extract(epoch FROM (now() - e.enviado_em)) / 86400)::int AS dias,
              (nullif(c.phone, '') IS NOT NULL) AS tem_fone, (nullif(c.email, '') IS NOT NULL) AS tem_email
       ${BASE}
       ORDER BY o.customer_id, e.enviado_em DESC
     ) t ORDER BY t.total::numeric DESC, t.id LIMIT ${MAX_LISTA}`,
    [storeId, dias, ESPERA_APOS_AVISO_DIAS],
  );
  return rows.map((r) => ({
    orderId: r.id,
    numero: r.numero,
    customerId: r.customer_id,
    nome: r.nome ?? `Cliente ${r.customer_id}`,
    cidade: r.cidade,
    uf: r.uf,
    total: Number(r.total),
    enviadoEm: r.enviado_em,
    diasDesdeEnvio: r.dias,
    temWhatsapp: r.tem_fone,
    temEmail: r.tem_email,
  }));
}

export async function contarPosVenda(db: Db, storeId: string, dias: number): Promise<number> {
  const [r] = await db.query<{ n: string }>(`SELECT count(DISTINCT o.customer_id)::text AS n ${BASE}`, [storeId, dias, ESPERA_APOS_AVISO_DIAS]);
  return Number(r?.n ?? 0);
}

export async function marcarAvisada(db: Db, storeId: string, orderId: string, customerId: string, actor: string): Promise<void> {
  await db.query(
    `INSERT INTO postsale_contacts (store_id, order_id, customer_id, contacted_at, contacted_by) VALUES ($1::uuid, $2::bigint, $3::bigint, now(), $4)
     ON CONFLICT (store_id, order_id) DO UPDATE SET contacted_at = now(), contacted_by = $4`,
    [storeId, orderId, customerId, actor],
  );
}

export interface ResultadoPosVenda {
  avisadas: number;
  voltaram: number;
  faturamento: number;
}

/** Das avisadas nos últimos 90 dias, quantas fizeram um novo pedido pago depois do aviso. Medida simples: não prova que o aviso trouxe a compra. */
export async function resultadoDoPosVenda(db: Db, storeId: string): Promise<ResultadoPosVenda> {
  const [r] = await db.query<{ avisadas: string; voltaram: string; faturamento: string | null }>(
    `SELECT count(DISTINCT p.customer_id)::text AS avisadas,
            count(DISTINCT p.customer_id) FILTER (WHERE o.id IS NOT NULL)::text AS voltaram,
            sum(o.total)::text AS faturamento
     FROM postsale_contacts p
     LEFT JOIN orders o ON o.store_id = p.store_id AND o.customer_id = p.customer_id AND o.created_at_remote > p.contacted_at
          AND o.payment_status = 'paid' AND coalesce(o.status, 'open') <> 'cancelled'
     WHERE p.store_id = $1::uuid AND p.contacted_at > now() - make_interval(days => $2::int)`,
    [storeId, JANELA_RESULTADO_DIAS],
  );
  return { avisadas: Number(r?.avisadas ?? 0), voltaram: Number(r?.voltaram ?? 0), faturamento: Number(r?.faturamento ?? 0) };
}
