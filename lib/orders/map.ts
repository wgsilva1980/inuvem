import type { Order } from "@/lib/nuvemshop/orders";

export interface PedidoMapeado {
  id: number;
  number: number | null;
  created_at_remote: string;
  total: number;
  discount: number;
  status: string | null;
  payment_status: string | null;
  shipping_status: string | null;
  tracking_code: string | null;
  customer_id: number | null;
  updated_at_remote: string | null;
}

export interface ItemMapeado {
  order_id: number;
  seq: number;
  product_id: number | null;
  variant_id: number | null;
  name: string | null;
  quantity: number;
  unit_price: number;
  variant_values: string[] | null;
}

const dinheiro = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
};
const data = (s: string | null | undefined): string | null => (s && Number.isFinite(Date.parse(s)) ? new Date(s).toISOString() : null);

/** Nome do produto no pedido: texto ou objeto multi-idioma ({pt: "..."}). */
const nomeDe = (v: unknown): string | null => {
  if (typeof v === "string") return v.trim().slice(0, 255) || null;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const t = typeof o.pt === "string" ? o.pt : Object.values(o).find((x): x is string => typeof x === "string");
    return t?.trim().slice(0, 255) || null;
  }
  return null;
};

/** Valores da variação como lista de textos (aceita lista de textos, de objetos {pt} ou um texto "Azul / P"). */
export function valoresDaVariacao(v: unknown): string[] | null {
  if (typeof v === "string") {
    const partes = v.split(/\s*[/,|]\s*/).map((x) => x.trim()).filter(Boolean);
    return partes.length > 0 ? partes : null;
  }
  if (!Array.isArray(v)) return null;
  const out = v.map((x) => nomeDe(x)).filter((x): x is string => x !== null);
  return out.length > 0 ? out : null;
}

/** Pedido da loja no formato das nossas tabelas. Devolve null se não tiver data de criação válida (não dá para colocar numa linha do tempo). */
export function mapearPedido(o: Order): { pedido: PedidoMapeado; itens: ItemMapeado[] } | null {
  const criado = data(o.created_at);
  if (!criado) return null;
  const itens = (o.products ?? []).map((l, i): ItemMapeado => {
    const q = Math.round(Number(l.quantity));
    return {
      order_id: o.id,
      seq: i + 1,
      product_id: l.product_id ?? null,
      variant_id: l.variant_id ?? null,
      name: nomeDe(l.name),
      quantity: Number.isFinite(q) && q > 0 ? q : 1,
      unit_price: dinheiro(l.price),
      variant_values: valoresDaVariacao(l.variant_values),
    };
  });
  return {
    pedido: {
      id: o.id,
      number: o.number ?? null,
      created_at_remote: criado,
      total: dinheiro(o.total),
      discount: dinheiro(o.discount),
      status: o.status ?? null,
      payment_status: o.payment_status ?? null,
      shipping_status: o.shipping_status ?? null,
      tracking_code: o.shipping_tracking_number?.trim().slice(0, 60) || null,
      customer_id: o.customer?.id ?? null,
      updated_at_remote: data(o.updated_at),
    },
    itens,
  };
}
