import { z } from "zod";
import type { NuvemshopClient, Page } from "./client";

const text = z.string().nullish();
const num = z.union([z.number(), z.string()]).nullish();

const addressSchema = z
  .object({
    address: text,
    number: text,
    floor: text,
    locality: text,
    city: text,
    province: text,
    zipcode: text,
    country: text,
  })
  .passthrough();

/** Cliente da loja. Tudo opcional além do ID: a API muda campos com o tempo e um cliente estranho não pode derrubar a sincronização. */
export const customerSchema = z
  .object({
    id: z.number(),
    name: text,
    email: text,
    phone: text,
    identification: text,
    default_address: addressSchema.nullish(),
    total_spent: num,
    last_order_id: z.number().nullish(),
    accepts_marketing: z.boolean().nullish(),
    created_at: text,
    updated_at: text,
  })
  .passthrough();
export type Customer = z.infer<typeof customerSchema>;

export interface ListCustomersParams {
  page?: number;
  per_page?: number;
  updated_at_min?: string;
  q?: string;
}

/** Uma página de clientes; os que não passam no schema são contados à parte (não interrompem). */
export async function listCustomers(c: NuvemshopClient, params: ListCustomersParams = {}): Promise<Page<Customer> & { invalidos: number; campos: string[] }> {
  const { page = 1, per_page = 200, ...query } = params;
  const result = await c.getPage<unknown>("/customers", query, page, per_page);
  const items: Customer[] = [];
  const campos = new Set<string>();
  let invalidos = 0;
  for (const raw of result.items) {
    if (raw && typeof raw === "object") for (const k of Object.keys(raw)) campos.add(k);
    const r = customerSchema.safeParse(raw);
    if (r.success) items.push(r.data);
    else invalidos++;
  }
  return { ...result, items, invalidos, campos: [...campos].sort() };
}
