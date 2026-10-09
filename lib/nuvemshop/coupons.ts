import { z } from "zod";
import type { NuvemshopClient, Page } from "./client";

const text = z.string().nullish();
const num = z.union([z.number(), z.string()]).nullish();

/** Cupom da loja. Tudo opcional além do ID e do código: a API muda campos com o tempo e um cupom estranho não pode derrubar a listagem. */
export const couponSchema = z
  .object({
    id: z.number(),
    code: z.string(),
    type: text,
    value: num,
    valid: z.boolean().nullish(),
    used: num,
    max_uses: num,
    start_date: text,
    end_date: text,
    min_price: num,
    first_consumer_purchase: z.boolean().nullish(),
    combines_with_other_discounts: z.boolean().nullish(),
  })
  .passthrough();
export type Coupon = z.infer<typeof couponSchema>;

/** O que enviamos ao criar. `value` vai como texto, como a loja devolve; datas em AAAA-MM-DD. */
export interface CouponInput {
  code?: string;
  type?: "percentage" | "absolute";
  value?: string;
  valid?: boolean;
  max_uses?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  min_price?: string | null;
  first_consumer_purchase?: boolean;
  combines_with_other_discounts?: boolean;
}

export async function listCoupons(c: NuvemshopClient, params: { page?: number; per_page?: number } = {}): Promise<Page<Coupon> & { invalidos: number; campos: string[] }> {
  const { page = 1, per_page = 200 } = params;
  const result = await c.getPage<unknown>("/coupons", {}, page, per_page);
  const items: Coupon[] = [];
  const campos = new Set<string>();
  let invalidos = 0;
  for (const raw of result.items) {
    if (raw && typeof raw === "object") for (const k of Object.keys(raw)) campos.add(k);
    const r = couponSchema.safeParse(raw);
    if (r.success) items.push(r.data);
    else invalidos++;
  }
  return { ...result, items, invalidos, campos: [...campos].sort() };
}

export const createCoupon = async (c: NuvemshopClient, input: CouponInput): Promise<Coupon> => couponSchema.parse(await c.post("/coupons", input));
export const updateCoupon = async (c: NuvemshopClient, id: number, input: CouponInput): Promise<Coupon> => couponSchema.parse(await c.put(`/coupons/${id}`, input));
