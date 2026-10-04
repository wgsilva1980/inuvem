import { NuvemshopError } from "@/lib/nuvemshop/errors";
import type { Product, ProductInput } from "@/lib/nuvemshop/types";
import { upsertProducts, type Db } from "@/lib/sync/repo";
import { buildProductInput, changedFields, pick, remoteToEdit, toEdit, type ProductEdit } from "./edit";
import { getProductDetail } from "./query";

/** Acesso à API da Nuvemshop (injetado para testar sem rede). */
export interface ProductApi {
  get(id: number): Promise<Product>;
  put(id: number, input: ProductInput): Promise<Product>;
}

export class ProductNotFoundError extends Error {
  constructor() {
    super("Produto não encontrado no espelho. Sincronize o catálogo e tente de novo.");
  }
}

/** O produto mudou na Nuvemshop depois da última sincronização; o espelho foi atualizado. */
export class ProductConflictError extends Error {
  constructor() {
    super("Este produto foi alterado na Nuvemshop depois que você abriu a página. Os dados foram atualizados: revise e salve de novo.");
  }
}

export type UpdateResult = { changed: false } | { changed: true; fields: string[] };

async function audit(
  db: Db,
  entry: { storeId: string; actor: string; productId: number; antes: unknown; depois: unknown; resultado: unknown; sucesso: boolean },
) {
  await db.query(
    `INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, antes, depois, resultado_api, sucesso)
     VALUES ($1::uuid, $2, 'produto.atualizar', 'produto', $3, $4::jsonb, $5::jsonb, $6::jsonb, $7)`,
    [entry.storeId, entry.actor, String(entry.productId), JSON.stringify(entry.antes), JSON.stringify(entry.depois), JSON.stringify(entry.resultado), entry.sucesso],
  );
}

/**
 * Salva a edição de um produto: confere se a Nuvemshop não mudou o produto por fora, envia só os campos
 * alterados, atualiza o espelho com a resposta da API e registra no histórico (também em caso de falha).
 */
export async function updateProduct(
  db: Db,
  api: ProductApi,
  args: { storeId: string; actor: string; productId: number; after: ProductEdit },
): Promise<UpdateResult> {
  const { storeId, actor, productId, after } = args;
  const detail = await getProductDetail(db, storeId, productId);
  if (!detail) throw new ProductNotFoundError();

  const before = toEdit(detail);
  const fields = changedFields(before, after);
  if (fields.length === 0) return { changed: false };

  // Detecta alteração feita na Nuvemshop (ou por outro admin) depois da última sincronização. Compara o
  // CONTEÚDO editável, não o `updated_at`: na loja real esse campo não avança com edições (nem pelo admin
  // da Nuvemshop, nem pela API), então não serve para detectar mudança.
  const remote = await api.get(productId);
  if (changedFields(before, remoteToEdit(remote)).length > 0) {
    await upsertProducts(db, storeId, [remote]);
    throw new ProductConflictError();
  }

  const input = buildProductInput(after, fields);
  const antes = pick(before, fields);
  const depois = pick(after, fields);
  try {
    const updated = await api.put(productId, input);
    await upsertProducts(db, storeId, [updated]);
    await audit(db, { storeId, actor, productId, antes, depois, resultado: { status: "ok", updated_at: updated.updated_at ?? null }, sucesso: true });
    return { changed: true, fields };
  } catch (err) {
    const resultado =
      err instanceof NuvemshopError ? { status: err.status, mensagem: err.apiMessage ?? err.message } : { mensagem: err instanceof Error ? err.message : String(err) };
    await audit(db, { storeId, actor, productId, antes, depois, resultado, sucesso: false });
    throw err;
  }
}
