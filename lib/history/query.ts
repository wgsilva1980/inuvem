import type { Db } from "@/lib/sync/repo";

export const HISTORY_PAGE_SIZE = 50;

export type HistoryType = "produto" | "variante" | "imagem" | "categoria" | "lote";
export const HISTORY_TYPES: HistoryType[] = ["produto", "variante", "imagem", "categoria", "lote"];

export interface HistoryFilters {
  tipo?: HistoryType;
  /** Só tentativas que falharam. */
  falhas?: boolean;
  /** Alterações de um produto (inclui as de suas variantes). */
  produto?: number;
  page?: number;
}

export interface HistoryEntry {
  id: string;
  created_at: string;
  actor_email: string;
  acao: string;
  entidade: string;
  entidade_id: string | null;
  sucesso: boolean;
  antes: unknown;
  depois: unknown;
  resultado_api: unknown;
  /** Nome legível do que foi alterado (produto, categoria, lote), quando ainda existe. */
  nome: string | null;
  /** Produto ao qual a entrada pertence (para o link), quando existe. */
  produto_id: string | null;
}

export interface HistoryPage {
  items: HistoryEntry[];
  total: number;
  page: number;
  pages: number;
}

const FROM = `
  FROM audit_log a
  LEFT JOIN products p ON a.entidade = 'produto' AND p.store_id = a.store_id AND p.id::text = a.entidade_id
  LEFT JOIN variants v ON a.entidade = 'variante' AND v.store_id = a.store_id AND v.id::text = a.entidade_id
  LEFT JOIN products vp ON vp.store_id = a.store_id AND vp.id = v.product_id
  LEFT JOIN categories c ON a.entidade = 'categoria' AND c.store_id = a.store_id AND c.id::text = a.entidade_id
  LEFT JOIN bulk_jobs j ON a.entidade = 'lote' AND j.store_id = a.store_id AND j.id::text = a.entidade_id`;

/** Linhas do registro de alterações (`audit_log`), da mais recente para a mais antiga, com o nome do que foi alterado. */
export async function listHistory(db: Db, storeId: string, filters: HistoryFilters = {}): Promise<HistoryPage> {
  const where = ["a.store_id = $1::uuid"];
  const params: unknown[] = [storeId];
  const add = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };

  if (filters.tipo && HISTORY_TYPES.includes(filters.tipo)) where.push(`a.acao LIKE ${add(`${filters.tipo}.%`)}`);
  if (filters.falhas) where.push("a.sucesso = false");
  if (filters.produto !== undefined) {
    const id = add(String(filters.produto));
    where.push(`((a.entidade = 'produto' AND a.entidade_id = ${id}) OR (a.entidade = 'variante' AND v.product_id::text = ${id}))`);
  }
  const whereSql = where.join(" AND ");

  const totalRow = await db.query<{ n: string }>(`SELECT count(*)::text AS n ${FROM} WHERE ${whereSql}`, params);
  const total = Number(totalRow[0]?.n ?? 0);
  const pages = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
  const page = Math.min(Math.max(1, filters.page ?? 1), pages);

  const items = await db.query<HistoryEntry>(
    `SELECT a.id::text AS id, a.created_at, a.actor_email, a.acao, a.entidade, a.entidade_id, a.sucesso, a.antes, a.depois, a.resultado_api,
            coalesce(p.name, vp.name, c.name, j.descricao) AS nome, coalesce(p.id, vp.id)::text AS produto_id
     ${FROM} WHERE ${whereSql}
     ORDER BY a.created_at DESC, a.id DESC LIMIT ${HISTORY_PAGE_SIZE} OFFSET ${(page - 1) * HISTORY_PAGE_SIZE}`,
    params,
  );
  return { items, total, page, pages };
}
