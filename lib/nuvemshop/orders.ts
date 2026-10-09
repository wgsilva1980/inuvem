import { z } from "zod";
import type { NuvemshopClient } from "./client";

const text = z.string().nullish();
const num = z.union([z.number(), z.string()]).nullish();

export const orderSchema = z
  .object({
    id: z.number(),
    number: z.number().nullish(),
    created_at: text,
    total: num,
    currency: text,
    status: text,
    payment_status: text,
    shipping_status: text,
    customer: z.object({ id: z.number().nullish(), email: text }).passthrough().nullish(),
    products: z.array(z.object({ name: z.unknown().optional(), quantity: num }).passthrough()).nullish(),
  })
  .passthrough();
export type Order = z.infer<typeof orderSchema>;

/**
 * Pedidos de um cliente: busca pelo e-mail (parâmetro `q`) e confere o ID do cliente em cada pedido, para nunca mostrar pedido de outra pessoa.
 * Se a busca por e-mail não for aceita pela API, devolve lista vazia (a tela avisa).
 */
export async function listCustomerOrders(c: NuvemshopClient, customer: { id: number; email: string | null }, limit = 20): Promise<Order[]> {
  if (!customer.email) return [];
  const result = await c.getPage<unknown>("/orders", { q: customer.email }, 1, 50);
  const out: Order[] = [];
  for (const raw of result.items) {
    const r = orderSchema.safeParse(raw);
    if (r.success && r.data.customer?.id === customer.id) out.push(r.data);
  }
  return out.sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))).slice(0, limit);
}
