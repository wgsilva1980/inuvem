import "server-only";
import { listCoupons, type Coupon, type NuvemshopClient } from "@/lib/nuvemshop";

export const MAX_CUPONS_LISTADOS = 1000;

/** Todos os cupons da loja (até o limite), lidos na hora: os cupons não são espelhados no banco. */
export async function todosOsCupons(client: NuvemshopClient): Promise<{ itens: Coupon[]; truncado: boolean; campos: string[] }> {
  const itens: Coupon[] = [];
  const campos = new Set<string>();
  let page: number | null = 1;
  for (let i = 0; page !== null && i < 20; i++) {
    const r = await listCoupons(client, { page });
    itens.push(...r.items);
    for (const c of r.campos) campos.add(c);
    if (itens.length >= MAX_CUPONS_LISTADOS) return { itens: itens.slice(0, MAX_CUPONS_LISTADOS), truncado: r.nextPage !== null || itens.length > MAX_CUPONS_LISTADOS, campos: [...campos] };
    page = r.nextPage;
  }
  return { itens, truncado: page !== null, campos: [...campos] };
}
