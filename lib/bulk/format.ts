import type { ItemChanges } from "./operations";

const brl = (v: string | null) => (v === null ? "sem promoção" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));

/** Linhas legíveis do que muda em um produto (antes → depois). */
export function describeChanges(changes: ItemChanges, categoryName: (id: number) => string): string[] {
  const lines: string[] = [];
  const p = changes.product;
  if (p?.published) lines.push(`Situação: ${p.published.antes ? "publicado" : "não publicado"} → ${p.published.depois ? "publicado" : "não publicado"}`);
  if (p?.categories) {
    const names = (ids: number[]) => ids.map(categoryName).join(", ") || "nenhuma";
    lines.push(`Categorias: ${names(p.categories.antes)} → ${names(p.categories.depois)}`);
  }
  for (const v of changes.variants) {
    const parts: string[] = [];
    if (v.price) parts.push(`preço ${brl(v.price.antes)} → ${brl(v.price.depois)}`);
    if (v.promotional_price) parts.push(`promocional ${brl(v.promotional_price.antes)} → ${brl(v.promotional_price.depois)}`);
    if (v.stock) parts.push(`estoque ${v.stock.antes ?? "sem quantidade"} → ${v.stock.depois}`);
    lines.push(`${v.label}${v.sku ? ` (${v.sku})` : ""}: ${parts.join(", ")}`);
  }
  return lines;
}

export const STATUS_LABEL = { preview: "Aguardando confirmação", running: "Em execução", completed: "Concluído", cancelled: "Cancelado" } as const;
export const ITEM_LABEL = { pending: "Pendente", processing: "Em andamento", ok: "Aplicado", error: "Erro", conflict: "Conflito (não alterado)" } as const;
