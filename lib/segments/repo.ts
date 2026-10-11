import type { Db } from "@/lib/sync/repo";
import type { ClienteAgregada } from "./regras";

/** Teto de clientes lidas: acima disso o painel mostra só as que mais gastaram. */
export const MAX_CLIENTES = 50_000;

/**
 * Uma linha por cliente com pedido pago e não cancelado (do espelho de pedidos, que só guarda o ID dela), ligada ao cadastro de clientes para nome e
 * contato. Quem foi ignorada em Contatos fica de fora.
 */
export async function clientesAgregadas(db: Db, storeId: string): Promise<ClienteAgregada[]> {
  const rows = await db.query<{ id: string; pedidos: string; gasto: string; primeira: string; ultima: string; meses6: string; nome: string | null; email: string | null; telefone: string | null; cidade: string | null; uf: string | null; marketing: boolean | null }>(
    `SELECT b.customer_id::text AS id, b.pedidos::text, b.gasto::text, b.primeira::text, b.ultima::text, b.meses6::text,
            c.name AS nome, nullif(c.email, '') AS email, nullif(c.phone, '') AS telefone, c.city AS cidade, c.state AS uf, c.accepts_marketing AS marketing
     FROM (
       SELECT o.customer_id, count(*) AS pedidos, sum(o.total) AS gasto, min(o.created_at_remote) AS primeira, max(o.created_at_remote) AS ultima,
              count(DISTINCT date_trunc('month', o.created_at_remote AT TIME ZONE 'America/Sao_Paulo')) FILTER (WHERE o.created_at_remote > now() - interval '6 months') AS meses6
       FROM orders o
       WHERE o.store_id = $1::uuid AND o.customer_id IS NOT NULL AND o.payment_status = 'paid' AND coalesce(o.status, 'open') <> 'cancelled'
       GROUP BY o.customer_id
     ) b
     LEFT JOIN customers c ON c.store_id = $1::uuid AND c.id = b.customer_id
     WHERE coalesce(c.ignored, false) = false
     ORDER BY b.gasto DESC, b.customer_id
     LIMIT ${MAX_CLIENTES}`,
    [storeId],
  );
  return rows.map((r) => ({
    id: r.id,
    nome: r.nome ?? `Cliente ${r.id}`,
    email: r.email?.includes("@") ? r.email : null,
    telefone: r.telefone,
    cidade: r.cidade,
    uf: r.uf,
    recusouContato: r.marketing === false,
    pedidos: Number(r.pedidos),
    gasto: Number(r.gasto),
    primeiraCompra: r.primeira,
    ultimaCompra: r.ultima,
    mesesComCompra6: Number(r.meses6),
  }));
}
