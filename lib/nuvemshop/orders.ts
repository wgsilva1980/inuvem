import { z } from "zod";
import type { NuvemshopClient, Page } from "./client";

const text = z.string().nullish();
const num = z.union([z.number(), z.string()]).nullish();

export const orderSchema = z
  .object({
    id: z.number(),
    number: z.number().nullish(),
    created_at: text,
    updated_at: text,
    total: num,
    discount: num,
    currency: text,
    status: text,
    payment_status: text,
    shipping_status: text,
    customer: z.object({ id: z.number().nullish(), email: text }).passthrough().nullish(),
    products: z
      .array(
        z
          .object({
            product_id: z.number().nullish(),
            variant_id: z.number().nullish(),
            name: z.unknown().optional(),
            quantity: num,
            price: num,
            variant_values: z.unknown().optional(),
          })
          .passthrough(),
      )
      .nullish(),
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

export interface ListOrdersParams {
  page?: number;
  per_page?: number;
  created_at_min?: string;
  updated_at_min?: string;
}

/** Uma página de pedidos (qualquer situação: o painel filtra depois); os que não passam no schema são contados à parte. */
export async function listOrdersPage(c: NuvemshopClient, params: ListOrdersParams = {}): Promise<Page<Order> & { invalidos: number; campos: string[] }> {
  const { page = 1, per_page = 200, ...query } = params;
  const result = await c.getPage<unknown>("/orders", query, page, per_page);
  const items: Order[] = [];
  const campos = new Set<string>();
  let invalidos = 0;
  for (const raw of result.items) {
    if (raw && typeof raw === "object") for (const k of Object.keys(raw)) campos.add(k);
    const r = orderSchema.safeParse(raw);
    if (r.success) items.push(r.data);
    else invalidos++;
  }
  return { ...result, items, invalidos, campos: [...campos].sort() };
}
