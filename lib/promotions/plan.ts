import { planOperation, type BulkOperation, type MirrorProduct, type Plan } from "@/lib/bulk/operations";

/**
 * Plano de uma promoção. Com descontos por produto (`percents`), calcula cada grupo com o seu percentual e junta tudo
 * na ordem dos produtos; sem eles, vale o percentual da operação para todos.
 */
export function planoDaPromocao(op: BulkOperation, percents: Record<string, number> | null | undefined, produtos: MirrorProduct[]): Plan {
  if (op.type !== "promocao" || !percents || Object.keys(percents).length === 0) return planOperation(op, produtos);
  const grupos = new Map<number, MirrorProduct[]>();
  for (const p of produtos) {
    const pct = percents[String(p.id)] ?? op.percent ?? 0;
    grupos.set(pct, [...(grupos.get(pct) ?? []), p]);
  }
  const ordem = new Map(produtos.map((p, i) => [p.id, i]));
  const plan: Plan = { items: [], ignorados: [] };
  for (const [percent, lista] of grupos) {
    const parte = planOperation({ ...op, percent }, lista);
    plan.items.push(...parte.items);
    plan.ignorados.push(...parte.ignorados);
  }
  plan.items.sort((a, b) => (ordem.get(a.productId) ?? 0) - (ordem.get(b.productId) ?? 0));
  return plan;
}

/** Resumo para mostrar: "20%" ou "de 15% a 40%". */
export function resumoPercentuais(op: BulkOperation, percents: Record<string, number> | null | undefined): string {
  const vals = Object.values(percents ?? {});
  if (vals.length === 0) return op.type === "promocao" && op.percent ? `${op.percent.toLocaleString("pt-BR")}%` : "";
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  return min === max ? `${min}%` : `de ${min}% a ${max}%`;
}
