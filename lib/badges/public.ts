import type { Db } from "@/lib/sync/repo";
import { PADRAO, obterConfig, type BadgeSettings } from "./settings";

/** O que a vitrine recebe de um produto. Só informação que a própria vitrine já mostra (nome) ou que é um aviso (últimas unidades, fim da promoção). */
export interface SelosDoProduto {
  v: 1;
  nome?: string;
  ultimas?: true;
  /** Quando a promoção termina (ISO). */
  promoAte?: string;
  whatsapp?: { numero: string; texto: string };
}

export const HANDLE_RE = /^[a-z0-9][a-z0-9-]{0,199}$/;

/** Regras puras, separadas do banco para testar. `estoque` = soma das variações com estoque controlado; `ilimitado` = há variação sem controle de estoque. */
export function montarSelos(c: BadgeSettings, p: { nome: string; estoque: number | null; ilimitado: boolean; promoAte: string | null }): SelosDoProduto {
  const out: SelosDoProduto = { v: 1, nome: p.nome };
  if (c.lowStockEnabled && !p.ilimitado && p.estoque !== null && p.estoque > 0 && p.estoque <= c.lowStockMax) out.ultimas = true;
  if (c.countdownEnabled && p.promoAte) out.promoAte = p.promoAte;
  if (c.whatsappEnabled && c.whatsappNumber) out.whatsapp = { numero: c.whatsappNumber, texto: c.whatsappMessage.replace(/\{produto\}/g, p.nome) };
  return out;
}

/** Selos de um produto publicado, pelo endereço (handle) na vitrine. Loja desconhecida, selos desligados ou produto fora do ar: resposta vazia. */
export async function selosPorHandle(db: Db, nuvemshopStoreId: string, handle: string): Promise<SelosDoProduto | null> {
  if (!/^\d{1,15}$/.test(nuvemshopStoreId) || !HANDLE_RE.test(handle)) return null;
  const loja = await db.query<{ id: string }>("SELECT id::text AS id FROM stores WHERE nuvemshop_store_id = $1::bigint", [nuvemshopStoreId]);
  const storeId = loja[0]?.id;
  if (!storeId) return null;
  const config = await obterConfig(db, storeId);
  if (!config.enabled) return null;
  const rows = await db.query<{ name: string; estoque: string | null; ilimitado: boolean | null; fim: string | null }>(
    `SELECT p.name,
            (SELECT sum(v.stock) FILTER (WHERE v.stock_management) FROM variants v WHERE v.store_id = p.store_id AND v.product_id = p.id)::text AS estoque,
            (SELECT bool_or(NOT v.stock_management) FROM variants v WHERE v.store_id = p.store_id AND v.product_id = p.id) AS ilimitado,
            (SELECT min(pr.ends_at) FROM promotions pr WHERE pr.store_id = p.store_id AND pr.status = 'ativa' AND pr.ends_at > now() AND pr.product_ids @> ARRAY[p.id])::text AS fim
     FROM products p WHERE p.store_id = $1::uuid AND p.handle = $2 AND p.published`,
    [storeId, handle],
  );
  const p = rows[0];
  if (!p) return null;
  return montarSelos(config, { nome: p.name, estoque: p.estoque === null ? null : Number(p.estoque), ilimitado: p.ilimitado ?? false, promoAte: p.fim ? new Date(p.fim).toISOString() : null });
}

export { PADRAO };
