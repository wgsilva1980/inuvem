import type { Db } from "@/lib/sync/repo";

export interface Fornecedor {
  id: string;
  nome: string;
}

/** Contatos do tipo “fornecedor” da loja (o cadastro de Contatos), por nome. */
export async function listarFornecedores(db: Db, storeId: string): Promise<Fornecedor[]> {
  return db.query<Fornecedor>(
    `SELECT id::text AS id, coalesce(nullif(trade_name, ''), name) AS nome FROM contacts
     WHERE store_id = $1::uuid AND kind = 'fornecedor' ORDER BY lower(coalesce(nullif(trade_name, ''), name)), id`,
    [storeId],
  );
}

/** Fornecedor do produto (null = nenhum). */
export async function fornecedorDoProduto(db: Db, storeId: string, productId: number): Promise<Fornecedor | null> {
  const rows = await db.query<Fornecedor>(
    `SELECT c.id::text AS id, coalesce(nullif(c.trade_name, ''), c.name) AS nome
     FROM product_suppliers s JOIN contacts c ON c.id = s.contact_id AND c.store_id = s.store_id
     WHERE s.store_id = $1::uuid AND s.product_id = $2::bigint`,
    [storeId, productId],
  );
  return rows[0] ?? null;
}

export class FornecedorInvalidoError extends Error {
  constructor() {
    super("O fornecedor escolhido não existe mais. Atualize a página e escolha de novo.");
  }
}

/** Define (ou tira, com `contactId` null) o fornecedor do produto. Só aceita contato do tipo fornecedor desta loja. Registra no Histórico só o id e o nome. */
export async function definirFornecedor(db: Db, args: { storeId: string; productId: number; contactId: number | null; actor: string }): Promise<{ changed: boolean }> {
  const { storeId, productId, contactId, actor } = args;
  const antes = await fornecedorDoProduto(db, storeId, productId);
  let depois: Fornecedor | null = null;
  if (contactId !== null) {
    const rows = await db.query<Fornecedor>(
      `SELECT id::text AS id, coalesce(nullif(trade_name, ''), name) AS nome FROM contacts WHERE store_id = $1::uuid AND id = $2::bigint AND kind = 'fornecedor'`,
      [storeId, contactId],
    );
    depois = rows[0] ?? null;
    if (!depois) throw new FornecedorInvalidoError();
  }
  if ((antes?.id ?? null) === (depois?.id ?? null)) return { changed: false };
  if (depois) {
    await db.query(
      `INSERT INTO product_suppliers (store_id, product_id, contact_id, updated_at, updated_by) VALUES ($1::uuid, $2::bigint, $3::bigint, now(), $4)
       ON CONFLICT (store_id, product_id) DO UPDATE SET contact_id = EXCLUDED.contact_id, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [storeId, productId, depois.id, actor],
    );
  } else {
    await db.query("DELETE FROM product_suppliers WHERE store_id = $1::uuid AND product_id = $2::bigint", [storeId, productId]);
  }
  await db.query(
    `INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, antes, depois, resultado_api, sucesso)
     VALUES ($1::uuid, $2, 'produto.fornecedor', 'produto', $3, $4::jsonb, $5::jsonb, $6::jsonb, true)`,
    [storeId, actor, String(productId), JSON.stringify({ fornecedor: antes?.nome ?? null, contato_id: antes?.id ?? null }), JSON.stringify({ fornecedor: depois?.nome ?? null, contato_id: depois?.id ?? null }), JSON.stringify({ status: "ok", local: "painel" })],
  );
  return { changed: true };
}
