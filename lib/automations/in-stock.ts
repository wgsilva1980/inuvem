import { NuvemshopError } from "@/lib/nuvemshop/errors";
import type { Product } from "@/lib/nuvemshop/types";
import { upsertProducts, type Db } from "@/lib/sync/repo";
import { todasSemEstoque } from "./out-of-stock";

export const ACAO_REPUBLICAR = "produto.republicar_com_estoque";
export const ATOR_REPUBLICAR = "Automação (estoque voltou)";

/** O produto tem o que vender: tem variações e nem todas estão zeradas (variação sem controle de estoque conta como disponível). */
export function temEstoque(p: Pick<Product, "variants">): boolean {
  return (p.variants ?? []).length > 0 && !todasSemEstoque(p);
}

export async function autoRepublicarLigado(db: Db, storeId: string): Promise<boolean> {
  const [r] = await db.query<{ ligado: boolean }>("SELECT auto_republish_in_stock AS ligado FROM store_settings WHERE store_id = $1::uuid", [storeId]);
  return r?.ligado === true;
}

export async function salvarAutoRepublicar(db: Db, storeId: string, ligado: boolean, actor: string): Promise<void> {
  await db.query(
    `INSERT INTO store_settings (store_id, auto_republish_in_stock, updated_by) VALUES ($1::uuid, $2, $3)
     ON CONFLICT (store_id) DO UPDATE SET auto_republish_in_stock = $2, updated_by = $3, updated_at = now()`,
    [storeId, ligado, actor],
  );
}

export type ResultadoRepublicar = "desligada" | "nao_se_aplica" | "republicado" | "falhou";

/**
 * Regra do webhook: se a opção está ligada, o produto está despublicado, foi a regra "sem estoque" que o despublicou (e a pessoa não pediu para
 * mantê-lo fora) e voltou a ter estoque, publica de novo na loja. Um produto publicado por fora sai da lista de espera. Seguro de repetir.
 */
export async function aplicarRegraRepublicar(
  db: Db,
  args: { storeId: string; produto: Product; setPublished?: (id: number, published: boolean) => Promise<Product>; forcar?: boolean; ator?: string },
): Promise<ResultadoRepublicar> {
  const { storeId, produto } = args;
  const ator = args.ator ?? ATOR_REPUBLICAR;
  const [marca] = await db.query<{ keep_unpublished: boolean }>("SELECT keep_unpublished FROM auto_unpublished WHERE store_id = $1::uuid AND product_id = $2::bigint", [storeId, produto.id]);
  if (!marca) return "nao_se_aplica";
  if (produto.published === true) {
    // alguém já publicou (ou a loja voltou sozinha): o produto não está mais esperando
    await db.query("DELETE FROM auto_unpublished WHERE store_id = $1::uuid AND product_id = $2::bigint", [storeId, produto.id]);
    return "nao_se_aplica";
  }
  if (!args.forcar && !(await autoRepublicarLigado(db, storeId))) return "desligada";
  if (marca.keep_unpublished || !temEstoque(produto) || !args.setPublished) return "nao_se_aplica";

  const base = { motivo: "o estoque voltou", variacoes: (produto.variants ?? []).length };
  try {
    const atualizado = await args.setPublished(produto.id, true);
    await upsertProducts(db, storeId, [atualizado]);
    await db.query("DELETE FROM auto_unpublished WHERE store_id = $1::uuid AND product_id = $2::bigint", [storeId, produto.id]);
    await db.query(
      `INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, antes, depois, resultado_api, sucesso)
       VALUES ($1::uuid, $2, $3, 'produto', $4, $5::jsonb, $6::jsonb, $7::jsonb, true)`,
      [storeId, ator, ACAO_REPUBLICAR, String(produto.id), JSON.stringify({ published: false }), JSON.stringify({ published: true, ...base }), JSON.stringify({ status: "ok" })],
    );
    return "republicado";
  } catch (err) {
    const resultado = err instanceof NuvemshopError ? { status: err.status, mensagem: err.apiMessage ?? err.message } : { mensagem: err instanceof Error ? err.message : String(err) };
    await db.query(
      `INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, antes, depois, resultado_api, sucesso)
       VALUES ($1::uuid, $2, $3, 'produto', $4, $5::jsonb, $6::jsonb, $7::jsonb, false)`,
      [storeId, ator, ACAO_REPUBLICAR, String(produto.id), JSON.stringify({ published: false }), JSON.stringify({ published: true, ...base }), JSON.stringify(resultado)],
    );
    return "falhou";
  }
}

export interface AguardandoEstoque {
  product_id: string;
  produto: string | null;
  desde: string;
  manter: boolean;
  /** O espelho já mostra estoque de volta (a regra republica no próximo aviso da loja, ou agora pelo botão). */
  comEstoque: boolean;
}

/** Produtos que a regra despublicou e ainda não voltaram. */
export async function listarAguardandoEstoque(db: Db, storeId: string): Promise<AguardandoEstoque[]> {
  const rows = await db.query<{ product_id: string; produto: string | null; desde: string; manter: boolean; com_estoque: boolean }>(
    `SELECT a.product_id::text, p.name AS produto, a.unpublished_at::text AS desde, a.keep_unpublished AS manter,
            (EXISTS (SELECT 1 FROM variants v WHERE v.store_id = a.store_id AND v.product_id = a.product_id)
             AND EXISTS (SELECT 1 FROM variants v WHERE v.store_id = a.store_id AND v.product_id = a.product_id
                         AND NOT (v.stock_management AND v.stock IS NOT NULL AND v.stock <= 0))) AS com_estoque
     FROM auto_unpublished a JOIN products p ON p.store_id = a.store_id AND p.id = a.product_id
     WHERE a.store_id = $1::uuid AND NOT p.published
     ORDER BY a.unpublished_at DESC`,
    [storeId],
  );
  return rows.map((r) => ({ product_id: r.product_id, produto: r.produto, desde: r.desde, manter: r.manter, comEstoque: r.com_estoque }));
}

/** "Manter despublicado": este produto não volta sozinho quando o estoque voltar. */
export async function definirManterDespublicado(db: Db, storeId: string, productId: number, manter: boolean): Promise<boolean> {
  const rows = await db.query("UPDATE auto_unpublished SET keep_unpublished = $3 WHERE store_id = $1::uuid AND product_id = $2::bigint RETURNING product_id", [storeId, productId, manter]);
  return rows.length > 0;
}

export interface ApiRepublicar {
  getProduct(id: number): Promise<Product>;
  setPublished(id: number, published: boolean): Promise<Product>;
}

/**
 * Republica agora os produtos da lista de espera que o espelho mostra com estoque. Confere cada um na loja antes. Ação manual: não depende da
 * opção estar ligada, mas respeita "manter despublicado". Retomável (`ignorar` = já tentados).
 */
export async function republicarComEstoqueAgora(
  db: Db,
  api: ApiRepublicar,
  args: { storeId: string; ator: string; budgetMs: number; ignorar?: string[]; now?: () => number },
): Promise<{ republicados: number; semEstoque: number; falhas: Array<{ productId: string; produto: string; mensagem: string }>; restantes: boolean }> {
  const now = args.now ?? Date.now;
  const inicio = now();
  const ignorar = new Set(args.ignorar ?? []);
  const out = { republicados: 0, semEstoque: 0, falhas: [] as Array<{ productId: string; produto: string; mensagem: string }>, restantes: false };
  while (true) {
    const [prox] = await db.query<{ id: string; name: string }>(
      `SELECT p.id::text AS id, p.name FROM auto_unpublished a JOIN products p ON p.store_id = a.store_id AND p.id = a.product_id
       WHERE a.store_id = $1::uuid AND NOT a.keep_unpublished AND NOT p.published AND NOT (p.id::text = ANY($2::text[]))
         AND EXISTS (SELECT 1 FROM variants v WHERE v.store_id = p.store_id AND v.product_id = p.id)
         AND EXISTS (SELECT 1 FROM variants v WHERE v.store_id = p.store_id AND v.product_id = p.id AND NOT (v.stock_management AND v.stock IS NOT NULL AND v.stock <= 0))
       ORDER BY p.id LIMIT 1`,
      [args.storeId, [...ignorar]],
    );
    if (!prox) return out;
    if (now() - inicio >= args.budgetMs) return { ...out, restantes: true };
    ignorar.add(prox.id);
    try {
      const atual = await api.getProduct(Number(prox.id));
      await upsertProducts(db, args.storeId, [atual]); // o espelho passa a refletir a loja
      const r = await aplicarRegraRepublicar(db, { storeId: args.storeId, produto: atual, setPublished: api.setPublished, forcar: true, ator: args.ator });
      if (r === "republicado") out.republicados++;
      else if (r === "falhou") out.falhas.push({ productId: prox.id, produto: prox.name, mensagem: "a loja recusou a alteração (veja o Histórico)" });
      else out.semEstoque++;
    } catch (err) {
      out.falhas.push({ productId: prox.id, produto: prox.name, mensagem: err instanceof NuvemshopError ? err.userMessage : err instanceof Error ? err.message : String(err) });
      if (out.falhas.length >= 5 && out.republicados === 0) return out;
    }
  }
}
