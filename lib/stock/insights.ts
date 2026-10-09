import { pt, type I18n } from "@/lib/nuvemshop/types";
import type { Db } from "@/lib/sync/repo";
import { SQL_VENDA } from "@/lib/orders/sync";

export interface VariacaoEstoque {
  variant_id: string;
  product_id: string;
  produto: string;
  publicado: boolean;
  sku: string | null;
  variacao: string;
  /** Estoque atual (só variações com controle de estoque entram). */
  estoque: number;
  /** Unidades vendidas na janela. */
  vendidas: number;
  /** Unidades por dia na janela. */
  ritmo: number;
}

/** Variações com controle de estoque e quanto cada uma vendeu nos últimos `dias` (pedidos pagos e não cancelados do espelho). */
export async function variacoesComRitmo(db: Db, storeId: string, dias: number): Promise<VariacaoEstoque[]> {
  const rows = await db.query<{ variant_id: string; product_id: string; produto: string; publicado: boolean; sku: string | null; valores: I18n[] | null; estoque: number | null; vendidas: string }>(
    `SELECT v.id::text AS variant_id, v.product_id::text AS product_id, p.name AS produto, p.published AS publicado, v.sku, v.values AS valores, v.stock AS estoque,
            coalesce(s.unidades, 0)::text AS vendidas
     FROM variants v JOIN products p ON p.store_id = v.store_id AND p.id = v.product_id
     LEFT JOIN (
       SELECT i.variant_id, sum(i.quantity) AS unidades
       FROM order_items i JOIN orders o ON o.store_id = i.store_id AND o.id = i.order_id
       WHERE i.store_id = $1::uuid AND i.variant_id IS NOT NULL AND ${SQL_VENDA} AND o.created_at_remote >= now() - make_interval(days => $2::int)
       GROUP BY i.variant_id
     ) s ON s.variant_id = v.id
     WHERE v.store_id = $1::uuid AND v.stock_management AND v.stock IS NOT NULL`,
    [storeId, dias],
  );
  return rows.map((r) => {
    const vendidas = Number(r.vendidas);
    return {
      variant_id: r.variant_id,
      product_id: r.product_id,
      produto: r.produto,
      publicado: r.publicado,
      sku: r.sku,
      variacao: (Array.isArray(r.valores) ? r.valores : []).map((x) => pt(x)).filter(Boolean).join(" / ") || "Padrão",
      estoque: r.estoque ?? 0,
      vendidas,
      ritmo: vendidas / dias,
    };
  });
}

export interface LinhaReposicao extends VariacaoEstoque {
  situacao: "esgotado" | "acabando";
  /** Em quantos dias o estoque acaba no ritmo atual (null = esgotado). */
  diasRestantes: number | null;
  /** Quantas unidades repor para cobrir `cobertura` dias no ritmo atual. */
  sugerido: number;
}

const sugestao = (v: VariacaoEstoque, cobertura: number) => Math.max(0, Math.ceil(v.ritmo * cobertura) - Math.max(v.estoque, 0));

/**
 * Acabando: tem estoque, vende, e no ritmo da janela acaba em até `limite` dias (do que acaba antes para o que acaba depois).
 * Esgotado que vendia: estoque zerado e vendeu na janela (do que mais vendeu para o que menos vendeu): é o que repor primeiro.
 */
export function classificarReposicao(vars: VariacaoEstoque[], opts: { limite: number; cobertura: number }): { acabando: LinhaReposicao[]; esgotados: LinhaReposicao[] } {
  const acabando: LinhaReposicao[] = [];
  const esgotados: LinhaReposicao[] = [];
  for (const v of vars) {
    if (v.vendidas <= 0) continue;
    if (v.estoque <= 0) esgotados.push({ ...v, situacao: "esgotado", diasRestantes: null, sugerido: sugestao(v, opts.cobertura) });
    else {
      const dias = v.estoque / v.ritmo;
      if (dias <= opts.limite) acabando.push({ ...v, situacao: "acabando", diasRestantes: dias, sugerido: sugestao(v, opts.cobertura) });
    }
  }
  acabando.sort((a, b) => a.diasRestantes! - b.diasRestantes! || b.vendidas - a.vendidas);
  esgotados.sort((a, b) => b.vendidas - a.vendidas || a.produto.localeCompare(b.produto, "pt-BR"));
  return { acabando, esgotados };
}

/** Formata os dias restantes: "menos de 1 dia", "6 dias". */
export const textoDias = (d: number): string => (d < 1 ? "menos de 1 dia" : `${Math.round(d)} ${Math.round(d) === 1 ? "dia" : "dias"}`);
