import { variacoesComRitmo } from "@/lib/stock/insights";
import type { Db } from "@/lib/sync/repo";
import { aCaminhoPorVariacao } from "./repo";
import { quantidadeSugerida } from "./rules";

export interface SugestaoCompra {
  variantId: string;
  productId: string;
  produto: string;
  variacao: string;
  sku: string | null;
  estoque: number;
  vendidas: number;
  ritmo: number;
  /** Em quantos dias o estoque acaba no ritmo da janela (null = já esgotado). */
  diasRestantes: number | null;
  aCaminho: number;
  sugerido: number;
  /** Custo unitário do produto (null = sem custo informado em Custos). */
  custo: number | null;
}

export async function custosPorProduto(db: Db, storeId: string): Promise<Map<string, number>> {
  const rows = await db.query<{ id: string; cost: string }>("SELECT product_id::text AS id, cost::text AS cost FROM product_costs WHERE store_id = $1::uuid", [storeId]);
  return new Map(rows.map((r) => [r.id, Number(r.cost)]));
}

/**
 * O que comprar: variações PUBLICADAS, com controle de estoque, que venderam na janela. A quantidade cobre o prazo de entrega mais a cobertura
 * desejada no ritmo da janela, descontando o estoque e o que já está a caminho. Esgotadas primeiro, depois as que acabam antes.
 */
export async function sugestoesDeCompra(db: Db, storeId: string, args: { janela: number; prazo: number; cobertura: number }): Promise<SugestaoCompra[]> {
  const [vars, caminho, custos] = await Promise.all([variacoesComRitmo(db, storeId, args.janela), aCaminhoPorVariacao(db, storeId), custosPorProduto(db, storeId)]);
  const out: SugestaoCompra[] = [];
  for (const v of vars) {
    if (!v.publicado || v.vendidas <= 0) continue;
    const aCaminho = caminho.get(v.variant_id) ?? 0;
    const sugerido = quantidadeSugerida({ ritmo: v.ritmo, estoque: v.estoque, aCaminho, prazo: args.prazo, cobertura: args.cobertura });
    if (sugerido <= 0) continue;
    out.push({
      variantId: v.variant_id, productId: v.product_id, produto: v.produto, variacao: v.variacao, sku: v.sku, estoque: v.estoque, vendidas: v.vendidas, ritmo: v.ritmo,
      diasRestantes: v.estoque <= 0 ? null : v.estoque / v.ritmo, aCaminho, sugerido, custo: custos.get(v.product_id) ?? null,
    });
  }
  out.sort((a, b) => Number(b.diasRestantes === null) - Number(a.diasRestantes === null) || (a.diasRestantes ?? 0) - (b.diasRestantes ?? 0) || b.vendidas - a.vendidas || a.produto.localeCompare(b.produto, "pt-BR"));
  return out;
}

export const investimento = (l: Array<{ sugerido: number; custo: number | null }>): { total: number; semCusto: number } => ({
  total: Math.round(l.reduce((s, x) => s + (x.custo === null ? 0 : x.custo * x.sugerido), 0) * 100) / 100,
  semCusto: l.filter((x) => x.custo === null).length,
});
