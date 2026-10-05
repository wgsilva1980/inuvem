import { NuvemshopError } from "@/lib/nuvemshop/errors";
import type { Db } from "@/lib/sync/repo";
import { ProductMissingError } from "./images";

export interface DeleteProductApi {
  deleteProduct(productId: number): Promise<void>;
}

type Args = { storeId: string; actor: string; productId: number };

const failure = (err: unknown) =>
  err instanceof NuvemshopError ? { status: err.status, mensagem: err.apiMessage ?? err.message } : { mensagem: err instanceof Error ? err.message : String(err) };

/** Exclui o produto na Nuvemshop e tira do espelho. Se a loja já não o tem (404), só limpa o espelho. Registra o resultado, também em falha. */
export async function deleteProduct(db: Db, api: DeleteProductApi, args: Args): Promise<{ name: string }> {
  const { storeId, actor, productId } = args;
  const rows = await db.query<{ name: string; variants: number }>(
    `SELECT p.name, (SELECT count(*)::int FROM variants v WHERE v.store_id = p.store_id AND v.product_id = p.id) AS variants
     FROM products p WHERE p.store_id = $1::uuid AND p.id = $2::bigint`,
    [storeId, productId],
  );
  if (!rows[0]) throw new ProductMissingError();
  const antes = { name: rows[0].name, variantes: rows[0].variants };

  const log = (sucesso: boolean, resultado: unknown) =>
    db.query(
      `INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, antes, depois, resultado_api, sucesso)
       VALUES ($1::uuid, $2, 'produto.apagar', 'produto', $3, $4::jsonb, '{}'::jsonb, $5::jsonb, $6)`,
      [storeId, actor, String(productId), JSON.stringify(antes), JSON.stringify(resultado), sucesso],
    );

  try {
    try {
      await api.deleteProduct(productId);
    } catch (err) {
      if (!(err instanceof NuvemshopError && err.status === 404)) throw err;
    }
    await db.query("DELETE FROM products WHERE store_id = $1::uuid AND id = $2::bigint", [storeId, productId]);
    await log(true, { status: "ok" });
  } catch (err) {
    await log(false, failure(err));
    throw err;
  }
  return { name: antes.name };
}
