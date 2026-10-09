import { ehCor, ehTamanho, padronizarCor, padronizarTamanho } from "@/lib/bulk/operations";
import { pt, type I18n } from "@/lib/nuvemshop/types";
import type { Db } from "@/lib/sync/repo";
import { SQL_VENDA } from "./sync";

/** Período em dias de calendário de Brasília, de `de` a `ate` inclusive (AAAA-MM-DD). */
export interface Periodo {
  de: string;
  ate: string;
}

export const DIAS_PERIODO = [7, 30, 90, 365] as const;

const DIA_MS = 86_400_000;
export const somarDias = (iso: string, n: number): string => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);

/** Os últimos `dias` dias terminando em `hoje`, e o período anterior de mesmo tamanho (para comparar). */
export function periodos(hoje: string, dias: number): { atual: Periodo; anterior: Periodo } {
  const atual = { de: somarDias(hoje, -(dias - 1)), ate: hoje };
  return { atual, anterior: { de: somarDias(atual.de, -dias), ate: somarDias(atual.de, -1) } };
}

const NO_PERIODO = "(o.created_at_remote AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $2::date AND $3::date";

export interface ResumoPeriodo {
  pedidos: number;
  faturamento: number;
  unidades: number;
  ticket: number;
}

export async function resumoDoPeriodo(db: Db, storeId: string, p: Periodo): Promise<ResumoPeriodo> {
  const [r] = await db.query<{ pedidos: string; faturamento: string; unidades: string }>(
    `SELECT count(*)::text AS pedidos, coalesce(sum(o.total), 0)::text AS faturamento,
            coalesce(sum((SELECT sum(i.quantity) FROM order_items i WHERE i.store_id = o.store_id AND i.order_id = o.id)), 0)::text AS unidades
     FROM orders o WHERE o.store_id = $1::uuid AND ${SQL_VENDA} AND ${NO_PERIODO}`,
    [storeId, p.de, p.ate],
  );
  const pedidos = Number(r?.pedidos ?? 0);
  const faturamento = Number(r?.faturamento ?? 0);
  return { pedidos, faturamento, unidades: Number(r?.unidades ?? 0), ticket: pedidos > 0 ? Math.round((faturamento / pedidos) * 100) / 100 : 0 };
}

export interface VendaDia {
  dia: string;
  pedidos: number;
  faturamento: number;
}

export async function vendasPorDia(db: Db, storeId: string, p: Periodo): Promise<VendaDia[]> {
  const rows = await db.query<{ dia: string; pedidos: string; faturamento: string }>(
    `SELECT to_char(d, 'YYYY-MM-DD') AS dia, count(o.id)::text AS pedidos, coalesce(sum(o.total), 0)::text AS faturamento
     FROM generate_series($2::date, $3::date, interval '1 day') d
     LEFT JOIN orders o ON o.store_id = $1::uuid AND ${SQL_VENDA} AND (o.created_at_remote AT TIME ZONE 'America/Sao_Paulo')::date = d::date
     GROUP BY d ORDER BY d`,
    [storeId, p.de, p.ate],
  );
  return rows.map((r) => ({ dia: r.dia, pedidos: Number(r.pedidos), faturamento: Number(r.faturamento) }));
}

export interface ProdutoVendido {
  product_id: string;
  nome: string;
  foto: string | null;
  unidades: number;
  valor: number;
  pedidos: number;
  /** Estoque atual (soma das variações com controle de estoque); null = sem controle. */
  estoque: number | null;
}

export type OrdemProdutos = "unidades" | "valor";

/** Produtos mais vendidos do período. `valor` = preço × quantidade das linhas (antes de descontos do pedido). */
export async function maisVendidos(db: Db, storeId: string, p: Periodo, ordem: OrdemProdutos, limit: number): Promise<ProdutoVendido[]> {
  const rows = await db.query<{ product_id: string; nome: string; foto: string | null; unidades: string; valor: string; pedidos: string; estoque: string | null }>(
    `SELECT i.product_id::text AS product_id, coalesce(max(pr.name), max(i.name), 'Produto ' || i.product_id) AS nome,
            max(pr.raw_json->'images'->0->>'src') AS foto,
            sum(i.quantity)::text AS unidades, sum(i.quantity * i.unit_price)::text AS valor, count(DISTINCT i.order_id)::text AS pedidos,
            (SELECT sum(v.stock) FILTER (WHERE v.stock_management)::text FROM variants v WHERE v.store_id = i.store_id AND v.product_id = i.product_id) AS estoque
     FROM order_items i JOIN orders o ON o.store_id = i.store_id AND o.id = i.order_id
     LEFT JOIN products pr ON pr.store_id = i.store_id AND pr.id = i.product_id
     WHERE i.store_id = $1::uuid AND i.product_id IS NOT NULL AND ${SQL_VENDA} AND ${NO_PERIODO}
     GROUP BY i.store_id, i.product_id
     ORDER BY ${ordem === "valor" ? "sum(i.quantity * i.unit_price)" : "sum(i.quantity)"} DESC, i.product_id
     LIMIT ${Math.max(1, Math.min(limit, 1000))}`,
    [storeId, p.de, p.ate],
  );
  return rows.map((r) => ({ product_id: r.product_id, nome: r.nome, foto: r.foto, unidades: Number(r.unidades), valor: Number(r.valor), pedidos: Number(r.pedidos), estoque: r.estoque === null ? null : Number(r.estoque) }));
}

export interface Fatia {
  nome: string;
  unidades: number;
  valor: number;
}

/** Vendas por categoria. Um produto em duas categorias conta nas duas (por isso a soma passa do total). */
export async function porCategoria(db: Db, storeId: string, p: Periodo, limit = 12): Promise<Fatia[]> {
  const rows = await db.query<{ nome: string; unidades: string; valor: string }>(
    `SELECT coalesce(max(cat.name), max(c->'name'->>'pt'), 'Categoria ' || (c->>'id')) AS nome, sum(i.quantity)::text AS unidades, sum(i.quantity * i.unit_price)::text AS valor
     FROM order_items i JOIN orders o ON o.store_id = i.store_id AND o.id = i.order_id
     JOIN products pr ON pr.store_id = i.store_id AND pr.id = i.product_id
     CROSS JOIN LATERAL jsonb_array_elements(pr.categories) c
     LEFT JOIN categories cat ON cat.store_id = i.store_id AND cat.id = nullif(c->>'id', '')::bigint
     WHERE i.store_id = $1::uuid AND ${SQL_VENDA} AND ${NO_PERIODO}
     GROUP BY c->>'id' ORDER BY sum(i.quantity * i.unit_price) DESC LIMIT ${limit}`,
    [storeId, p.de, p.ate],
  );
  return rows.map((r) => ({ nome: r.nome, unidades: Number(r.unidades), valor: Number(r.valor) }));
}

/**
 * Vendas por cor e por tamanho. Os valores da variação vêm da linha do pedido (ou da variação do espelho, se o pedido não os trouxer) e
 * são lidos pela posição da propriedade COR ou TAMANHO do produto. `semDado` = unidades cuja variação não foi possível identificar.
 */
export async function porCorETamanho(db: Db, storeId: string, p: Periodo, limit = 12): Promise<{ cores: Fatia[]; tamanhos: Fatia[]; semDado: number }> {
  const rows = await db.query<{ valores: string[] | null; atributos: I18n[] | null; unidades: string; valor: string }>(
    `SELECT coalesce(i.variant_values, (SELECT jsonb_agg(e->>'pt') FROM jsonb_array_elements(v.values) e)) AS valores,
            pr.raw_json->'attributes' AS atributos, sum(i.quantity)::text AS unidades, sum(i.quantity * i.unit_price)::text AS valor
     FROM order_items i JOIN orders o ON o.store_id = i.store_id AND o.id = i.order_id
     LEFT JOIN products pr ON pr.store_id = i.store_id AND pr.id = i.product_id
     LEFT JOIN variants v ON v.store_id = i.store_id AND v.id = i.variant_id
     WHERE i.store_id = $1::uuid AND ${SQL_VENDA} AND ${NO_PERIODO}
     GROUP BY 1, 2`,
    [storeId, p.de, p.ate],
  );
  const cores = new Map<string, Fatia>();
  const tamanhos = new Map<string, Fatia>();
  let semDado = 0;
  const somar = (m: Map<string, Fatia>, nome: string, un: number, valor: number) => {
    const f = m.get(nome) ?? { nome, unidades: 0, valor: 0 };
    f.unidades += un;
    f.valor += valor;
    m.set(nome, f);
  };
  for (const r of rows) {
    const un = Number(r.unidades);
    const valor = Number(r.valor);
    const valores = Array.isArray(r.valores) ? r.valores : [];
    const nomes = (Array.isArray(r.atributos) ? r.atributos : []).map((a) => pt(a));
    const iCor = nomes.findIndex(ehCor);
    const iTam = nomes.findIndex(ehTamanho);
    const cor = iCor >= 0 ? valores[iCor] : undefined;
    const tam = iTam >= 0 ? valores[iTam] : undefined;
    if (cor) somar(cores, padronizarCor(cor), un, valor);
    if (tam) somar(tamanhos, padronizarTamanho(tam), un, valor);
    if (!cor && !tam) semDado += un;
  }
  const top = (m: Map<string, Fatia>) => [...m.values()].sort((a, b) => b.valor - a.valor).slice(0, limit);
  return { cores: top(cores), tamanhos: top(tamanhos), semDado };
}

/** Quantos pedidos há no espelho e a data do mais antigo e do mais recente (para avisar quando o período pedido passa do que foi lido). */
export async function coberturaDosPedidos(db: Db, storeId: string): Promise<{ total: number; primeiro: string | null; ultimo: string | null }> {
  const [r] = await db.query<{ total: string; primeiro: string | null; ultimo: string | null }>(
    `SELECT count(*)::text AS total, to_char(min(created_at_remote AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM-DD') AS primeiro, to_char(max(created_at_remote AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM-DD') AS ultimo
     FROM orders WHERE store_id = $1::uuid`,
    [storeId],
  );
  return { total: Number(r?.total ?? 0), primeiro: r?.primeiro ?? null, ultimo: r?.ultimo ?? null };
}
