import { z } from "zod";
import type { NuvemshopClient, Page } from "./client";

const text = z.string().nullish();
const num = z.union([z.number(), z.string()]).nullish();

/** Checkout (carrinho) da loja. Tudo opcional além do ID: a API muda campos com o tempo e um carrinho estranho não pode derrubar a lista. */
export const checkoutSchema = z
  .object({
    id: z.number(),
    token: text,
    contact_name: text,
    contact_email: text,
    contact_phone: text,
    total: num,
    created_at: text,
    updated_at: text,
    completed_at: text,
    abandoned_checkout_url: text,
    products: z
      .array(z.object({ product_id: z.number().nullish(), variant_id: z.number().nullish(), name: z.unknown().optional(), quantity: num, price: num }).passthrough())
      .nullish(),
  })
  .passthrough();
export type Checkout = z.infer<typeof checkoutSchema>;

export async function listCheckouts(c: NuvemshopClient, params: { page?: number; per_page?: number; created_at_min?: string } = {}): Promise<Page<Checkout> & { invalidos: number; campos: string[] }> {
  const { page = 1, per_page = 200, ...query } = params;
  const result = await c.getPage<unknown>("/checkouts", query, page, per_page);
  const items: Checkout[] = [];
  const campos = new Set<string>();
  let invalidos = 0;
  for (const raw of result.items) {
    if (raw && typeof raw === "object") for (const k of Object.keys(raw)) campos.add(k);
    const r = checkoutSchema.safeParse(raw);
    if (r.success) items.push(r.data);
    else invalidos++;
  }
  return { ...result, items, invalidos, campos: [...campos].sort() };
}

export const getCheckout = async (c: NuvemshopClient, id: number): Promise<Checkout> => checkoutSchema.parse(await c.get(`/checkouts/${id}`));
