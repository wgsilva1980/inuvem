import type { Db } from "@/lib/sync/repo";

export interface Parado {
  id: string;
  name: string;
  published: boolean;
  /** Soma do estoque das variações com controle de estoque. */
  estoque: number;
  precoMin: number;
  precoMax: number;
  /** Alguma variação já tem preço promocional. */
  jaEmPromocao: boolean;
  /** Unidades vendidas na janela lida. */
  vendidas: number;
  ultimaVenda: string | null;
  criadoEm: string | null;
  /** Dias desde a última venda (ou desde o cadastro, se nunca vendeu na janela), limitado à janela. */
  diasParado: number;
  /** Dinheiro parado em estoque, a preço cheio. */
  valorParado: number;
  /** Custo do produto guardado no painel (null = não informado). */
  custo?: number | null;
}

export interface FiltroParados {
  /** Sem venda há pelo menos este número de dias. */
  dias: number;
  minEstoque: number;
  apenasPublicados: boolean;
  janelaDias: number;
  limit: number;
}

interface Linha {
  id: string;
  name: string;
  published: boolean;
  estoque: string;
  preco_min: string | null;
  preco_max: string | null;
  em_promocao: boolean;
  vendidas: string | null;
  ultima_venda: string | null;
  criado_em: string | null;
  dias_parado: string;
  custo: string | null;
}

/**
 * Produtos com estoque e sem venda há `dias` (pelo resumo de vendas lido da loja), do maior dinheiro parado para o menor. Ficam de fora os
 * cadastrados há menos de `dias` (não tiveram tempo de vender) e os que já estão em outra promoção que não terminou.
 */
export async function listarParados(db: Db, storeId: string, f: FiltroParados): Promise<{ itens: Parado[]; total: number }> {
  const rows = await db.query<Linha & { total: string }>(
    `WITH base AS (
       SELECT p.id, p.name, p.published, nullif(p.raw_json->>'created_at', '')::timestamptz AS criado_em,
              coalesce(sum(v.stock) FILTER (WHERE v.stock_management AND v.stock > 0), 0) AS estoque,
              min(v.price) FILTER (WHERE v.price > 0) AS preco_min, max(v.price) AS preco_max,
              coalesce(bool_or(v.promotional_price IS NOT NULL AND v.promotional_price > 0), false) AS em_promocao,
              sum(v.price * v.stock) FILTER (WHERE v.stock_management AND v.stock > 0) AS valor,
              s.units AS vendidas, s.last_sold_at AS ultima_venda, pc.cost AS custo
       FROM products p
       JOIN variants v ON v.store_id = p.store_id AND v.product_id = p.id
       LEFT JOIN product_sales s ON s.store_id = p.store_id AND s.product_id = p.id
       LEFT JOIN product_costs pc ON pc.store_id = p.store_id AND pc.product_id = p.id
       WHERE p.store_id = $1::uuid ${f.apenasPublicados ? "AND p.published" : ""}
         AND NOT EXISTS (SELECT 1 FROM promotions pr WHERE pr.store_id = p.store_id AND pr.status NOT IN ('encerrada', 'cancelada') AND p.id = ANY(pr.product_ids))
       GROUP BY p.store_id, p.id, s.units, s.last_sold_at, pc.cost
     ), calc AS (
       SELECT *, least($4::int, greatest(0, extract(day FROM now() - coalesce(ultima_venda, criado_em, now() - make_interval(days => $4::int))))::int) AS dias_parado
       FROM base WHERE estoque >= $3::int
     ), filtrado AS (
       SELECT * FROM calc
       WHERE (ultima_venda IS NULL OR ultima_venda < now() - make_interval(days => $2::int))
         AND (criado_em IS NULL OR criado_em < now() - make_interval(days => $2::int))
     )
     SELECT id::text, name, published, estoque::text, preco_min::text, preco_max::text, em_promocao, vendidas::text,
            ultima_venda::text, criado_em::text, dias_parado::text, custo::text, (SELECT count(*) FROM filtrado)::text AS total
     FROM filtrado ORDER BY valor DESC NULLS LAST, lower(name), id LIMIT ${Math.max(1, Math.min(f.limit, 500))}`,
    [storeId, f.dias, f.minEstoque, f.janelaDias],
  );
  const itens = rows.map((r) => {
    const estoque = Number(r.estoque);
    const precoMin = Number(r.preco_min ?? r.preco_max ?? 0);
    return {
      id: r.id,
      name: r.name,
      published: r.published,
      estoque,
      precoMin,
      precoMax: Number(r.preco_max ?? 0),
      jaEmPromocao: r.em_promocao,
      vendidas: Number(r.vendidas ?? 0),
      ultimaVenda: r.ultima_venda,
      criadoEm: r.criado_em,
      diasParado: Number(r.dias_parado),
      valorParado: Math.round(estoque * precoMin * 100) / 100,
      custo: r.custo === null ? null : Number(r.custo),
    };
  });
  return { itens, total: Number(rows[0]?.total ?? 0) };
}

/** Desconto de partida pelo tempo parado: quanto mais tempo sem vender, maior. Entre 10% e 60%, de 5 em 5. */
export function descontoBase(p: Pick<Parado, "diasParado" | "estoque" | "jaEmPromocao">): number {
  let d = p.diasParado >= 270 ? 40 : p.diasParado >= 180 ? 30 : p.diasParado >= 120 ? 25 : p.diasParado >= 90 ? 20 : 15;
  if (p.estoque >= 20) d += 5; // muito estoque parado: um pouco mais de empurrão
  if (p.jaEmPromocao) d += 5; // já tinha desconto e não saiu
  return Math.min(60, Math.max(10, d));
}
