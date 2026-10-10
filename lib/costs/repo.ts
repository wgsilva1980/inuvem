import type { Db } from "@/lib/sync/repo";
import { margemPercent } from "./math";

export type OrigemCusto = "manual" | "planilha" | "loja";

export async function margemMinima(db: Db, storeId: string): Promise<number> {
  const [r] = await db.query<{ m: string }>("SELECT min_margin::text AS m FROM cost_settings WHERE store_id = $1::uuid", [storeId]);
  return Number(r?.m ?? 0);
}

export async function salvarMargemMinima(db: Db, storeId: string, valor: number, actor: string): Promise<void> {
  await db.query(
    `INSERT INTO cost_settings (store_id, min_margin, updated_at, updated_by) VALUES ($1::uuid, $2, now(), $3)
     ON CONFLICT (store_id) DO UPDATE SET min_margin = $2, updated_at = now(), updated_by = $3`,
    [storeId, valor, actor],
  );
}

export interface DefinirCusto {
  productId: string;
  /** null = apagar o custo. */
  custo: number | null;
}

/** Grava (ou apaga) o custo de vários produtos de uma vez. Só mexe em produtos que existem no espelho da loja. Devolve quantos mudaram. */
export async function definirCustos(db: Db, args: { storeId: string; actor: string; origem: OrigemCusto; itens: DefinirCusto[] }): Promise<{ gravados: number; apagados: number; desconhecidos: string[] }> {
  const ids = args.itens.map((i) => i.productId);
  const existentes = new Set((await db.query<{ id: string }>("SELECT id::text AS id FROM products WHERE store_id = $1::uuid AND id::text = ANY($2::text[])", [args.storeId, ids])).map((r) => r.id));
  const validos = args.itens.filter((i) => existentes.has(i.productId));
  const comCusto = validos.filter((i) => i.custo !== null);
  const semCusto = validos.filter((i) => i.custo === null);
  if (comCusto.length > 0) {
    await db.query(
      `INSERT INTO product_costs (store_id, product_id, cost, source, updated_at, updated_by)
       SELECT $1::uuid, x.id::bigint, x.cost::numeric, $2, now(), $3 FROM jsonb_to_recordset($4::jsonb) AS x(id text, cost text)
       ON CONFLICT (store_id, product_id) DO UPDATE SET cost = EXCLUDED.cost, source = EXCLUDED.source, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [args.storeId, args.origem, args.actor, JSON.stringify(comCusto.map((i) => ({ id: i.productId, cost: (i.custo as number).toFixed(2) })))],
    );
  }
  if (semCusto.length > 0) await db.query("DELETE FROM product_costs WHERE store_id = $1::uuid AND product_id = ANY($2::bigint[])", [args.storeId, semCusto.map((i) => i.productId)]);
  return { gravados: comCusto.length, apagados: semCusto.length, desconhecidos: ids.filter((i) => !existentes.has(i)) };
}

/**
 * Custos que a própria loja já guarda nas variações (campo `cost` do espelho): copia para o painel, como custo do produto, a média dos custos
 * das variações com custo, só nos produtos que ainda não têm custo no painel.
 */
export async function lerCustosDaLoja(db: Db, storeId: string, actor: string): Promise<number> {
  const rows = await db.query<{ product_id: string }>(
    `INSERT INTO product_costs (store_id, product_id, cost, source, updated_by)
     SELECT v.store_id, v.product_id, round(avg((v.raw_json->>'cost')::numeric), 2), 'loja', $2
     FROM variants v
     WHERE v.store_id = $1::uuid AND coalesce(v.raw_json->>'cost', '') ~ '^[0-9]+(\\.[0-9]+)?$' AND (v.raw_json->>'cost')::numeric > 0
       AND NOT EXISTS (SELECT 1 FROM product_costs c WHERE c.store_id = v.store_id AND c.product_id = v.product_id)
     GROUP BY v.store_id, v.product_id
     ON CONFLICT DO NOTHING RETURNING product_id::text AS product_id`,
    [storeId, actor],
  );
  return rows.length;
}

export type FiltroCustos = "todos" | "sem_custo" | "margem_baixa" | "abaixo_do_custo";

export interface LinhaCusto {
  id: string;
  nome: string;
  publicado: boolean;
  sku: string | null;
  /** Menor preço de venda hoje (o promocional, se houver, senão o preço). */
  preco: number | null;
  custo: number | null;
  origem: OrigemCusto | null;
  margem: number | null;
}

export const POR_PAGINA = 50;

/** Produtos com custo, preço e margem, mais vendidos primeiro no que for igual por nome. `margemBaixa` = abaixo da margem mínima. */
export async function listarCustos(db: Db, storeId: string, f: { q?: string; filtro: FiltroCustos; margemMinima: number; pagina: number }): Promise<{ itens: LinhaCusto[]; total: number }> {
  const params: unknown[] = [storeId];
  const cond: string[] = [];
  if (f.q) {
    params.push(`%${f.q.replace(/[%_\\]/g, "\\$&")}%`);
    cond.push(`(b.nome ILIKE $${params.length} OR b.sku ILIKE $${params.length})`);
  }
  if (f.filtro === "sem_custo") cond.push("b.custo IS NULL");
  if (f.filtro === "abaixo_do_custo") cond.push("b.custo IS NOT NULL AND b.preco IS NOT NULL AND b.preco < b.custo");
  if (f.filtro === "margem_baixa") {
    params.push(f.margemMinima);
    cond.push(`b.custo IS NOT NULL AND b.preco > 0 AND ((b.preco - b.custo) / b.preco * 100) < $${params.length}`);
  }
  params.push(POR_PAGINA, (Math.max(1, f.pagina) - 1) * POR_PAGINA);
  const rows = await db.query<{ id: string; nome: string; publicado: boolean; sku: string | null; preco: string | null; custo: string | null; origem: OrigemCusto | null; total: string }>(
    `WITH b AS (
       SELECT p.id, p.name AS nome, p.published AS publicado,
              (SELECT min(v.sku) FROM variants v WHERE v.store_id = p.store_id AND v.product_id = p.id AND v.sku IS NOT NULL AND v.sku <> '') AS sku,
              (SELECT min(CASE WHEN v.promotional_price > 0 THEN v.promotional_price ELSE v.price END) FROM variants v WHERE v.store_id = p.store_id AND v.product_id = p.id AND v.price > 0) AS preco,
              c.cost AS custo, c.source AS origem
       FROM products p LEFT JOIN product_costs c ON c.store_id = p.store_id AND c.product_id = p.id
       WHERE p.store_id = $1::uuid
     )
     SELECT b.id::text AS id, b.nome, b.publicado, b.sku, b.preco::text AS preco, b.custo::text AS custo, b.origem, count(*) OVER ()::text AS total
     FROM b ${cond.length > 0 ? `WHERE ${cond.join(" AND ")}` : ""}
     ORDER BY b.publicado DESC, lower(b.nome), b.id LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return {
    total: Number(rows[0]?.total ?? 0),
    itens: rows.map((r) => {
      const preco = r.preco === null ? null : Number(r.preco);
      const custo = r.custo === null ? null : Number(r.custo);
      return { id: r.id, nome: r.nome, publicado: r.publicado, sku: r.sku, preco, custo, origem: r.origem, margem: preco !== null && custo !== null ? margemPercent(preco, custo) : null };
    }),
  };
}

export interface ResumoCustos {
  produtos: number;
  comCusto: number;
  publicadosSemCusto: number;
  abaixoDoCusto: number;
}

export async function resumoDeCustos(db: Db, storeId: string): Promise<ResumoCustos> {
  const [r] = await db.query<{ produtos: string; com_custo: string; pub_sem: string; abaixo: string }>(
    `WITH b AS (
       SELECT p.published, c.cost,
              (SELECT min(CASE WHEN v.promotional_price > 0 THEN v.promotional_price ELSE v.price END) FROM variants v WHERE v.store_id = p.store_id AND v.product_id = p.id AND v.price > 0) AS preco
       FROM products p LEFT JOIN product_costs c ON c.store_id = p.store_id AND c.product_id = p.id WHERE p.store_id = $1::uuid
     )
     SELECT count(*)::text AS produtos, count(cost)::text AS com_custo,
            count(*) FILTER (WHERE published AND cost IS NULL)::text AS pub_sem,
            count(*) FILTER (WHERE cost IS NOT NULL AND preco IS NOT NULL AND preco < cost)::text AS abaixo
     FROM b`,
    [storeId],
  );
  return { produtos: Number(r?.produtos ?? 0), comCusto: Number(r?.com_custo ?? 0), publicadosSemCusto: Number(r?.pub_sem ?? 0), abaixoDoCusto: Number(r?.abaixo ?? 0) };
}
