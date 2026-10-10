import { NuvemshopError } from "@/lib/nuvemshop/errors";
import type { Order } from "@/lib/nuvemshop/orders";
import type { Db } from "@/lib/sync/repo";
import { JA_ENVIADO } from "./queue";

export const ACAO_ENVIAR = "pedido.enviar";

export interface ApiExpedicao {
  getOrder(id: number): Promise<Order>;
  fulfillOrder(id: number, args: { codigo: string; url?: string | null; notificar: boolean }): Promise<Order>;
}

export interface EnvioPedido {
  orderId: number;
  codigo: string;
  url?: string | null;
}

export interface ResultadoEnvio {
  orderId: number;
  numero: number | null;
  ok: boolean;
  pulado?: boolean;
  erro?: string;
}

const mensagemDe = (err: unknown) => (err instanceof NuvemshopError ? err.userMessage : err instanceof Error ? err.message : String(err));
const enviado = (o: Order) => JA_ENVIADO.includes((o.shipping_status ?? "") as (typeof JA_ENVIADO)[number]);

/**
 * Marca pedidos como enviados na loja, um por vez: relê o pedido na loja antes (o espelho pode estar velho) e só envia se ele ainda é uma venda
 * paga, aberta e não enviada. Atualiza o espelho e registra no Histórico só o número do pedido e o código (nunca dados da cliente).
 * Sem permissão (401/403) para na hora; outros erros ficam no pedido e o lote segue.
 */
export async function marcarComoEnviados(
  db: Db,
  api: ApiExpedicao,
  args: { storeId: string; actor: string; envios: EnvioPedido[]; notificar: boolean },
): Promise<ResultadoEnvio[]> {
  const out: ResultadoEnvio[] = [];
  for (const e of args.envios) {
    let numero: number | null = null;
    try {
      const atual = await api.getOrder(e.orderId);
      numero = atual.number ?? null;
      if (atual.payment_status !== "paid" || atual.status === "cancelled" || atual.status === "closed") {
        out.push({ orderId: e.orderId, numero, ok: false, pulado: true, erro: "o pedido não está mais pago e aberto na loja" });
        continue;
      }
      if (enviado(atual)) {
        await db.query("UPDATE orders SET shipping_status = $3, tracking_code = coalesce($4, tracking_code) WHERE store_id = $1::uuid AND id = $2::bigint", [args.storeId, e.orderId, atual.shipping_status, atual.shipping_tracking_number ?? null]);
        out.push({ orderId: e.orderId, numero, ok: false, pulado: true, erro: "já estava enviado na loja" });
        continue;
      }
      const depois = await api.fulfillOrder(e.orderId, { codigo: e.codigo, url: e.url ?? null, notificar: args.notificar });
      await db.query("UPDATE orders SET shipping_status = coalesce($3, 'shipped'), tracking_code = $4, synced_at = now() WHERE store_id = $1::uuid AND id = $2::bigint", [
        args.storeId,
        e.orderId,
        depois.shipping_status ?? null,
        depois.shipping_tracking_number ?? e.codigo,
      ]);
      await db.query(
        `INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, antes, depois, resultado_api, sucesso) VALUES ($1::uuid, $2, $3, 'pedido', $4, $5::jsonb, $6::jsonb, $7::jsonb, true)`,
        [args.storeId, args.actor, ACAO_ENVIAR, String(e.orderId), JSON.stringify({ shipping_status: atual.shipping_status ?? null }), JSON.stringify({ numero, rastreio: e.codigo, notificou_cliente: args.notificar }), JSON.stringify({ status: "ok" })],
      );
      out.push({ orderId: e.orderId, numero, ok: true });
    } catch (err) {
      await db.query(
        `INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, depois, resultado_api, sucesso) VALUES ($1::uuid, $2, $3, 'pedido', $4, $5::jsonb, $6::jsonb, false)`,
        [args.storeId, args.actor, ACAO_ENVIAR, String(e.orderId), JSON.stringify({ numero, rastreio: e.codigo }), JSON.stringify(err instanceof NuvemshopError ? { status: err.status, mensagem: err.apiMessage ?? err.message } : { mensagem: mensagemDe(err) })],
      );
      out.push({ orderId: e.orderId, numero, ok: false, erro: mensagemDe(err) });
      if (err instanceof NuvemshopError && (err.status === 401 || err.status === 403)) break;
    }
  }
  return out;
}
