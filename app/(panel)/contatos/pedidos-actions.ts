"use server";

import { requireAdmin } from "@/lib/auth/admin";
import { getClienteDaLoja } from "@/lib/contacts/repo";
import { query } from "@/lib/db";
import { NuvemshopError, listCustomerOrders } from "@/lib/nuvemshop";
import { clientForStore, getActiveStore } from "@/lib/stores";

export interface PedidoLinha {
  id: number;
  numero: number | null;
  data: string | null;
  total: string | null;
  status: string;
  pagamento: string;
  envio: string;
  itens: number;
}

export type PedidosResultado = { ok: true; pedidos: PedidoLinha[] } | { ok: false; message: string };

const STATUS: Record<string, string> = { open: "Aberto", closed: "Arquivado", cancelled: "Cancelado" };
const PAGAMENTO: Record<string, string> = { pending: "Pendente", authorized: "Autorizado", paid: "Pago", voided: "Anulado", refunded: "Reembolsado", abandoned: "Abandonado" };
const ENVIO: Record<string, string> = { unpacked: "Não embalado", unfulfilled: "Não enviado", fulfilled: "Enviado", shipped: "Enviado", delivered: "Entregue", partially_fulfilled: "Enviado em parte" };

/** Últimos pedidos do cliente da loja ligado ao contato (leitura na Nuvemshop; nada é guardado aqui). */
export async function carregarPedidos(contactId: number): Promise<PedidosResultado> {
  await requireAdmin();
  if (!Number.isInteger(contactId) || contactId <= 0) return { ok: false, message: "Contato inválido." };
  const store = await getActiveStore();
  if (!store) return { ok: false, message: "Nenhuma loja conectada." };
  const cliente = await getClienteDaLoja({ query }, store.id, contactId);
  if (!cliente) return { ok: false, message: "Este contato não está ligado a um cliente da loja." };
  try {
    const pedidos = await listCustomerOrders(await clientForStore(store), { id: Number(cliente.customer_id), email: cliente.email });
    return {
      ok: true,
      pedidos: pedidos.map((o) => ({
        id: o.id,
        numero: o.number ?? null,
        data: o.created_at ?? null,
        total: o.total === null || o.total === undefined ? null : String(o.total),
        status: STATUS[o.status ?? ""] ?? o.status ?? "",
        pagamento: PAGAMENTO[o.payment_status ?? ""] ?? o.payment_status ?? "",
        envio: ENVIO[o.shipping_status ?? ""] ?? o.shipping_status ?? "",
        itens: (o.products ?? []).reduce((s, p) => s + (Number(p.quantity) || 0), 0),
      })),
    };
  } catch (err) {
    if (err instanceof NuvemshopError) return { ok: false, message: err.userMessage };
    return { ok: false, message: "Não foi possível buscar os pedidos agora." };
  }
}
