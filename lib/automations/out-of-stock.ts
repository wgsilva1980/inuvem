import { NuvemshopError } from "@/lib/nuvemshop/errors";
import type { Product } from "@/lib/nuvemshop/types";
import { upsertProducts, type Db } from "@/lib/sync/repo";

export const ACAO_DESPUBLICAR = "produto.despublicar_sem_estoque";
export const ATOR_AUTOMACAO = "Automação (sem estoque)";

/**
 * Produto sem estoque em todas as variações: tem variações e TODAS controlam estoque e estão com estoque zero (ou negativo).
 * Variação sem controle de estoque, ou com controle mas sem quantidade informada, conta como disponível (estoque ilimitado).
 */
export function todasSemEstoque(p: Pick<Product, "variants">): boolean {
  const variantes = p.variants ?? [];
  return variantes.length > 0 && variantes.every((v) => v.stock_management === true && typeof v.stock === "number" && v.stock <= 0);
}

export async function autoDespublicarLigado(db: Db, storeId: string): Promise<boolean> {
  const [r] = await db.query<{ ligado: boolean }>("SELECT auto_unpublish_out_of_stock AS ligado FROM store_settings WHERE store_id = $1::uuid", [storeId]);
  return r?.ligado === true;
}

export async function salvarAutoDespublicar(db: Db, storeId: string, ligado: boolean, actor: string): Promise<void> {
  await db.query(
    `INSERT INTO store_settings (store_id, auto_unpublish_out_of_stock, updated_by) VALUES ($1::uuid, $2, $3)
     ON CONFLICT (store_id) DO UPDATE SET auto_unpublish_out_of_stock = $2, updated_by = $3, updated_at = now()`,
    [storeId, ligado, actor],
  );
}

export type ResultadoRegra = "desligada" | "nao_se_aplica" | "despublicado" | "falhou";

/**
 * Regra do webhook: se a opção está ligada, o produto está publicado e todas as variações estão sem estoque, despublica na loja
 * (PUT published=false), atualiza o espelho e registra no Histórico. Seguro de repetir: o PUT gera um novo evento, mas o produto já
 * chega despublicado e a regra não faz nada. Uma falha não derruba o webhook; fica registrada e a próxima atualização tenta de novo.
 */
export async function aplicarRegraSemEstoque(
  db: Db,
  args: { storeId: string; produto: Product; setPublished?: (id: number, published: boolean) => Promise<Product>; forcar?: boolean; ator?: string },
): Promise<ResultadoRegra> {
  const { storeId, produto } = args;
  const ator = args.ator ?? ATOR_AUTOMACAO;
  if (!args.forcar && !(await autoDespublicarLigado(db, storeId))) return "desligada";
  if (produto.published !== true || !todasSemEstoque(produto) || !args.setPublished) return "nao_se_aplica";

  const base = { motivo: "todas as variações estão sem estoque", variacoes: (produto.variants ?? []).length };
  try {
    const atualizado = await args.setPublished(produto.id, false);
    await upsertProducts(db, storeId, [atualizado]);
    await db.query(
      `INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, antes, depois, resultado_api, sucesso)
       VALUES ($1::uuid, $2, $3, 'produto', $4, $5::jsonb, $6::jsonb, $7::jsonb, true)`,
      [storeId, ator, ACAO_DESPUBLICAR, String(produto.id), JSON.stringify({ published: true }), JSON.stringify({ published: false, ...base }), JSON.stringify({ status: "ok" })],
    );
    // lembra que foi a regra que tirou o produto da loja: só esses podem voltar sozinhos quando o estoque voltar
    await db.query(
      `INSERT INTO auto_unpublished (store_id, product_id) VALUES ($1::uuid, $2::bigint)
       ON CONFLICT (store_id, product_id) DO UPDATE SET unpublished_at = now()`,
      [storeId, produto.id],
    );
    return "despublicado";
  } catch (err) {
    const resultado = err instanceof NuvemshopError ? { status: err.status, mensagem: err.apiMessage ?? err.message } : { mensagem: err instanceof Error ? err.message : String(err) };
    await db.query(
      `INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, antes, depois, resultado_api, sucesso)
       VALUES ($1::uuid, $2, $3, 'produto', $4, $5::jsonb, $6::jsonb, $7::jsonb, false)`,
      [storeId, ator, ACAO_DESPUBLICAR, String(produto.id), JSON.stringify({ published: true }), JSON.stringify({ published: false, ...base }), JSON.stringify(resultado)],
    );
    return "falhou";
  }
}

/** Produtos publicados no espelho cujas variações estão todas sem estoque (a regra só age quando chega um evento deles). */
export async function contarPublicadosSemEstoque(db: Db, storeId: string): Promise<number> {
  const [r] = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM products p
     WHERE p.store_id = $1::uuid AND p.published
       AND EXISTS (SELECT 1 FROM variants v WHERE v.store_id = p.store_id AND v.product_id = p.id)
       AND NOT EXISTS (SELECT 1 FROM variants v WHERE v.store_id = p.store_id AND v.product_id = p.id
                       AND NOT (v.stock_management AND v.stock IS NOT NULL AND v.stock <= 0))`,
    [storeId],
  );
  return Number(r?.n ?? 0);
}

export interface AcaoAutomatica {
  id: string;
  acao: string;
  created_at: string;
  product_id: string;
  produto: string | null;
  sucesso: boolean;
  mensagem: string | null;
}

export async function ultimasAcoesAutomaticas(db: Db, storeId: string, limite = 20): Promise<AcaoAutomatica[]> {
  return db.query<AcaoAutomatica>(
    `SELECT a.id::text, a.acao, a.created_at::text, a.entidade_id AS product_id, p.name AS produto, a.sucesso, a.resultado_api->>'mensagem' AS mensagem
     FROM audit_log a LEFT JOIN products p ON p.store_id = a.store_id AND p.id::text = a.entidade_id
     WHERE a.store_id = $1::uuid AND a.acao = ANY($2::text[]) ORDER BY a.id DESC LIMIT $3`,
    [storeId, [ACAO_DESPUBLICAR, "produto.republicar_com_estoque"], limite],
  );
}

export interface ApiDespublicar {
  getProduct(id: number): Promise<Product>;
  setPublished(id: number, published: boolean): Promise<Product>;
}

/**
 * Aplica a regra agora aos produtos publicados que o espelho mostra sem estoque em todas as variações. Para cada um, confere o estado atual na
 * loja antes de despublicar (o espelho pode estar velho). Ação manual: não depende da opção estar ligada. Retomável (`ignorar` = já tentados).
 */
export async function despublicarSemEstoqueAgora(
  db: Db,
  api: ApiDespublicar,
  args: { storeId: string; ator: string; budgetMs: number; ignorar?: string[]; now?: () => number },
): Promise<{ despublicados: number; jaOk: number; falhas: Array<{ productId: string; produto: string; mensagem: string }>; restantes: boolean }> {
  const now = args.now ?? Date.now;
  const inicio = now();
  const ignorar = new Set(args.ignorar ?? []);
  const out = { despublicados: 0, jaOk: 0, falhas: [] as Array<{ productId: string; produto: string; mensagem: string }>, restantes: false };
  while (true) {
    const [prox] = await db.query<{ id: string; name: string }>(
      `SELECT p.id::text AS id, p.name FROM products p
       WHERE p.store_id = $1::uuid AND p.published
         AND EXISTS (SELECT 1 FROM variants v WHERE v.store_id = p.store_id AND v.product_id = p.id)
         AND NOT EXISTS (SELECT 1 FROM variants v WHERE v.store_id = p.store_id AND v.product_id = p.id
                         AND NOT (v.stock_management AND v.stock IS NOT NULL AND v.stock <= 0))
         AND NOT (p.id::text = ANY($2::text[]))
       ORDER BY p.id LIMIT 1`,
      [args.storeId, [...ignorar]],
    );
    if (!prox) return out;
    if (now() - inicio >= args.budgetMs) return { ...out, restantes: true };
    ignorar.add(prox.id);
    try {
      const atual = await api.getProduct(Number(prox.id));
      await upsertProducts(db, args.storeId, [atual]); // o espelho passa a refletir a loja, mesmo que a regra não se aplique mais
      const r = await aplicarRegraSemEstoque(db, { storeId: args.storeId, produto: atual, setPublished: api.setPublished, forcar: true, ator: args.ator });
      if (r === "despublicado") out.despublicados++;
      else if (r === "falhou") out.falhas.push({ productId: prox.id, produto: prox.name, mensagem: "a loja recusou a alteração (veja o Histórico)" });
      else out.jaOk++;
    } catch (err) {
      out.falhas.push({ productId: prox.id, produto: prox.name, mensagem: err instanceof NuvemshopError ? err.userMessage : err instanceof Error ? err.message : String(err) });
      if (out.falhas.length >= 5 && out.despublicados === 0) return out;
    }
  }
}
